import { beforeEach, describe, expect, it } from "vitest";
import { userItem } from "../../src/auth/users.js";
import { approvedClient, config, createStudio, json, ORIGIN, type Studio } from "../helpers/deps.js";

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
});

/** The `name=value` pairs a browser would send back from the response's Set-Cookie headers. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .filter((pair) => !pair?.endsWith("="))
    .join("; ");
}

function setCookieLine(response: Response, name: string): string {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`)) ?? "";
}

/** Walks the sign-in: login redirect, then the callback with the code the sign-in site would send. */
async function signIn(sub = "sub-owner", email = "owner@example.com") {
  const login = await studio.app.request("/auth/login");
  const authorize = new URL(login.headers.get("location")!);
  studio.tokenEndpoint.idToken = await studio.signer.idToken(config, {
    sub,
    email,
    nonce: authorize.searchParams.get("nonce"),
  });
  const callback = await studio.app.request(`/auth/callback?code=good-code&state=${authorize.searchParams.get("state")}`, {
    headers: { cookie: cookiesFrom(login) },
  });
  return { login, authorize, callback, cookie: cookiesFrom(callback) };
}

const write = (path: string, cookie: string, origin: string | undefined = ORIGIN) =>
  studio.app.request(path, { method: "POST", headers: { cookie, ...(origin ? { origin } : {}) } });

describe("dashboard sign-in", () => {
  it("sends the browser to managed login with PKCE and keeps the state in a short-lived cookie", async () => {
    const { login, authorize } = await signIn();
    expect(login.status).toBe(302);
    expect(authorize.origin + authorize.pathname).toBe("https://login.example.com/oauth2/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "dashboard-client",
      redirect_uri: `${ORIGIN}/auth/callback`,
      code_challenge_method: "S256",
    });
    const line = setCookieLine(login, "__Host-a11w_login");
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Max-Age=600/);
  });

  it("makes a 12-hour session with a locked-down cookie after a good callback", async () => {
    const { callback, cookie } = await signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    const line = setCookieLine(callback, "__Host-a11w_session");
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Strict/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(new RegExp(`Max-Age=${12 * 60 * 60}`));
    expect(line).not.toMatch(/Domain=/);

    const me = await studio.app.request("/api/me", { headers: { cookie } });
    expect(await json(me)).toEqual({ email: "owner@example.com", role: "owner" });
  });

  it("sends the PKCE verifier that matches the challenge when it trades the code", async () => {
    const { authorize } = await signIn();
    const sent = studio.tokenRequests.at(-1)!;
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("good-code");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sent.get("code_verifier")!));
    expect(Buffer.from(digest).toString("base64url")).toBe(authorize.searchParams.get("code_challenge"));
  });

  it("stores only a hash of the session id", async () => {
    const { cookie } = await signIn();
    const sessionId = cookie.split("__Host-a11w_session=")[1]!;
    const stored = await studio.table.query("SESSION");
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(sessionId);
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    const login = await studio.app.request("/auth/login");
    const callback = await studio.app.request("/auth/callback?code=good-code&state=forged", {
      headers: { cookie: cookiesFrom(login) },
    });
    expect(callback.headers.get("location")).toBe("/signed-out?reason=failed");
    expect(await studio.table.query("SESSION")).toEqual([]);
  });

  it("refuses a callback with no sign-in cookie", async () => {
    const callback = await studio.app.request("/auth/callback?code=good-code&state=anything");
    expect(callback.headers.get("location")).toBe("/signed-out?reason=failed");
  });

  it("refuses an ID token whose nonce is not the one it sent", async () => {
    const login = await studio.app.request("/auth/login");
    const authorize = new URL(login.headers.get("location")!);
    studio.tokenEndpoint.idToken = await studio.signer.idToken(config, { nonce: "another-nonce" });
    const callback = await studio.app.request(`/auth/callback?code=c&state=${authorize.searchParams.get("state")}`, {
      headers: { cookie: cookiesFrom(login) },
    });
    expect(callback.headers.get("location")).toBe("/signed-out?reason=failed");
  });

  it("refuses a person who signed in but has no invitation", async () => {
    const { callback } = await signIn("sub-stranger", "stranger@example.com");
    expect(callback.headers.get("location")).toBe("/signed-out?reason=denied");
    expect(await studio.table.query("SESSION")).toEqual([]);
  });

  it("answers /api/me with 401 without a cookie and after the session expires", async () => {
    expect((await studio.app.request("/api/me")).status).toBe(401);
    const { cookie } = await signIn();
    studio.clock.now = new Date(studio.clock.now.getTime() + 12 * 60 * 60 * 1000 + 1000);
    expect((await studio.app.request("/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("ends the session on logout and returns the address that ends the managed-login session", async () => {
    const { cookie } = await signIn();
    const logout = await write("/auth/logout", cookie);
    const { redirect } = await json(logout);
    expect(redirect).toContain("https://login.example.com/logout?client_id=dashboard-client");
    expect((await studio.app.request("/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("refuses a logout that comes from another site", async () => {
    const { cookie } = await signIn();
    expect((await write("/auth/logout", cookie, "https://evil.example.com")).status).toBe(403);
    expect((await studio.app.request("/api/me", { headers: { cookie } })).status).toBe(200);
  });
});

describe("connections", () => {
  beforeEach(async () => {
    studio.cognito.register("client-1", { name: "Devin", callbackUrls: ["https://agent.example.com/cb"] });
    await studio.approvals.statusOf("client-1", "owner@example.com");
  });

  it("lists a pending client with its callback addresses", async () => {
    const { cookie } = await signIn();
    const response = await studio.app.request("/api/clients", { headers: { cookie } });
    expect((await json(response)).clients).toMatchObject([
      { clientId: "client-1", name: "Devin", callbackUrls: ["https://agent.example.com/cb"], status: "pending" },
    ]);
  });

  it("refuses the list without a session", async () => {
    expect((await studio.app.request("/api/clients")).status).toBe(401);
  });

  it("lets the owner approve, and the client then works", async () => {
    const { cookie } = await signIn();
    const response = await write("/api/clients/client-1/approve", cookie);
    expect((await json(response)).client.status).toBe("approved");
    expect(await studio.approvals.statusOf("client-1", "owner@example.com")).toBe("approved");
  });

  it("lets the owner revoke, which deletes the app client", async () => {
    await approvedClient(studio);
    const { cookie } = await signIn();
    expect((await write("/api/clients/client-1/revoke", cookie)).status).toBe(200);
    expect(studio.cognito.clients.has("client-1")).toBe(false);
  });

  it("refuses an approval from another site, and one with no Origin header", async () => {
    const { cookie } = await signIn();
    expect((await write("/api/clients/client-1/approve", cookie, "https://evil.example.com")).status).toBe(403);
    expect((await studio.app.request("/api/clients/client-1/approve", { method: "POST", headers: { cookie } })).status).toBe(403);
    expect(await studio.approvals.statusOf("client-1", "owner@example.com")).toBe("pending");
  });

  it("ends a person's session at once when they are disabled", async () => {
    const { cookie } = await signIn();
    await studio.table.put({ ...userItem({ sub: "sub-owner", email: "owner@example.com", role: "owner" }), disabled: true });

    expect((await studio.app.request("/api/me", { headers: { cookie } })).status).toBe(401);
    const approve = await studio.app.request("/api/clients/client-1/approve", {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
    });
    expect(approve.status).toBe(401);
  });

  it("uses the person's current role, not the one at sign-in", async () => {
    const { cookie } = await signIn();
    await studio.table.put(userItem({ sub: "sub-owner", email: "owner@example.com", role: "member" }));

    const approve = await studio.app.request("/api/clients/client-1/approve", {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
    });
    expect(approve.status).toBe(403);
    expect((await json(await studio.app.request("/api/me", { headers: { cookie } }))).role).toBe("member");
  });

  it("refuses an approval by a member", async () => {
    const { cookie } = await signIn("sub-member", "member@example.com");
    expect((await write("/api/clients/client-1/approve", cookie)).status).toBe(403);
    expect(await studio.approvals.statusOf("client-1", "owner@example.com")).toBe("pending");
  });

  it("answers 404 for a client it has never seen", async () => {
    const { cookie } = await signIn();
    expect((await write("/api/clients/ghost/approve", cookie)).status).toBe(404);
  });
});

describe("router", () => {
  it("answers the health check with the build id and nothing else", async () => {
    const response = await studio.app.request("/api/health");
    expect(await json(response)).toEqual({ ok: true, buildId: "test-build" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers an unknown API path with JSON 404", async () => {
    const response = await studio.app.request("/api/nothing-here");
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "not_found" });
  });
});
