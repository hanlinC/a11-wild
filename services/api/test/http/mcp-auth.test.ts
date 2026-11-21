import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvedClient, config, createStudio, json, ORIGIN, type Studio } from "../helpers/deps.js";

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
});

function post(token?: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "ping" }) {
  return studio.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("sign-in for MCP clients", () => {
  it("answers a call with no token with 401 and the address of the resource metadata", async () => {
    const response = await post();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("publishes metadata that names the MCP address and the user pool", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await studio.app.request(path);
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [config.issuer],
        scopes_supported: [`${ORIGIN}/mcp/studio`],
      });
    }
  });

  it("refuses a token that is bound to another server", async () => {
    await approvedClient(studio);
    const token = await studio.signer.accessToken(config, { aud: "https://other.example.com/mcp" });
    expect((await post(token)).status).toBe(401);
  });

  it("refuses a token from another issuer", async () => {
    await approvedClient(studio);
    const token = await studio.signer.accessToken(config, { iss: "https://issuer.example.com/pool" });
    expect((await post(token)).status).toBe(401);
  });

  it("refuses a token without the studio scope with 403 and names the scope", async () => {
    await approvedClient(studio);
    const response = await post(await studio.signer.accessToken(config, { scope: "openid" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("www-authenticate")).toContain(`scope="${config.mcpScope}"`);
  });

  it("refuses an ID token in place of an access token", async () => {
    await approvedClient(studio);
    const token = await studio.signer.accessToken(config, { token_use: "id" });
    expect((await post(token)).status).toBe(401);
  });

  it("refuses an expired token", async () => {
    await approvedClient(studio);
    const token = await studio.signer.accessToken(config, {}, Math.floor(Date.now() / 1000) - 60);
    expect((await post(token)).status).toBe(401);
  });

  it("refuses a token that is not a JWT", async () => {
    expect((await post("not-a-token")).status).toBe(401);
  });

  it("holds a new client as pending, with its callback addresses, until the owner approves it", async () => {
    studio.cognito.register("client-1", { name: "Devin", callbackUrls: ["https://agent.example.com/cb"] });
    const token = await studio.signer.accessToken(config);

    const waiting = await post(token);
    expect(waiting.status).toBe(403);
    expect((await json(waiting)).error.message).toContain(`${ORIGIN}/connections`);
    expect(await studio.approvals.list()).toMatchObject([
      {
        clientId: "client-1",
        name: "Devin",
        callbackUrls: ["https://agent.example.com/cb"],
        status: "pending",
        firstSeenBy: "owner@example.com",
      },
    ]);

    await studio.approvals.approve("client-1");
    const allowed = await post(token);
    expect(allowed.status).toBe(200);
    expect(await json(allowed)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("refuses a revoked client and deletes its app client", async () => {
    await approvedClient(studio);
    await studio.approvals.revoke("client-1");
    expect(studio.cognito.clients.has("client-1")).toBe(false);
    const response = await post(await studio.signer.accessToken(config));
    expect(response.status).toBe(403);
    expect((await json(response)).error.message).toContain("revoked");
  });

  it("refuses a client that the user pool does not know, and stores nothing", async () => {
    const response = await post(await studio.signer.accessToken(config, { client_id: "ghost" }));
    expect(response.status).toBe(403);
    expect(await studio.approvals.list()).toEqual([]);
  });

  it("never treats the dashboard's own client as an MCP client", async () => {
    studio.cognito.register(config.dashboardClientId);
    const response = await post(await studio.signer.accessToken(config, { client_id: config.dashboardClientId }));
    expect(response.status).toBe(403);
    expect(await studio.approvals.list()).toEqual([]);
  });

  it("refuses a user with no invitation, and a disabled user", async () => {
    await approvedClient(studio);
    expect((await post(await studio.signer.accessToken(config, { sub: "sub-stranger" }))).status).toBe(403);

    await studio.table.put({ pk: "USER", sk: "sub-owner", email: "owner@example.com", role: "owner", disabled: true });
    expect((await post(await studio.signer.accessToken(config))).status).toBe(403);
  });

  it("logs why a call was refused, and never the token", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await post("not-a-token");
      studio.cognito.register("client-1", { name: "Devin" });
      const token = await studio.signer.accessToken(config);
      await post(token);

      const refusals = written.filter((line) => line.includes("mcp_refused")).map((line) => JSON.parse(line));
      expect(refusals.map((refusal) => refusal.reason)).toEqual([expect.stringMatching(/^Jwt\w+Error$/), "client_pending"]);
      expect(refusals[1].client).toBe("client-1");
      expect(written.join("")).not.toContain(token);
      expect(written.join("")).not.toContain("not-a-token");
    } finally {
      spy.mockRestore();
    }
  });

  it("offers only POST on the MCP address", async () => {
    const response = await studio.app.request("/mcp");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
