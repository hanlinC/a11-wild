import { describe, expect, it } from "vitest";
import { PROBES, runProbes } from "./probe.mjs";

const ORIGIN = "https://studio.example.com";
const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

/** A studio that answers every probe correctly, with room to break one answer. */
function healthyStudio(overrides = {}) {
  const routes = {
    "GET /": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    "GET /api/health": () => Response.json({ ok: true, buildId: "abc" }),
    "POST /mcp": () =>
      Response.json(
        { error: "unauthorized" },
        {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
          },
        },
      ),
    "GET /.well-known/oauth-protected-resource/mcp": () =>
      Response.json({ resource: `${ORIGIN}/mcp`, authorization_servers: ["https://issuer.example.com"] }),
    "GET /api/me": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/clients": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/brands": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/spend": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/taste": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/batches/none/board": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "POST /api/clients/probe/approve": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/no-such-path": () => Response.json({ error: "not_found" }, { status: 404 }),
    ...overrides,
  };
  return async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const response = routes[key]();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name) && !response.headers.has("x-no-security-headers")) response.headers.set(name, value);
    }
    return response;
  };
}

const failedNames = async (overrides) => (await runProbes(ORIGIN, healthyStudio(overrides))).map((f) => f.name);

describe("live probe", () => {
  it("passes against a studio that answers correctly", async () => {
    expect(await runProbes(ORIGIN, healthyStudio())).toEqual([]);
  });

  it("fails and names the check when health is down", async () => {
    expect(await failedNames({ "GET /api/health": () => new Response("no", { status: 502 }) })).toEqual([
      "health answers",
    ]);
  });

  it("fails when the MCP address answers without a token", async () => {
    expect(await failedNames({ "POST /mcp": () => Response.json({ result: {} }) })).toEqual([
      "MCP without a token is refused and points to the resource metadata",
    ]);
  });

  it("fails when the 401 does not point to the resource metadata", async () => {
    const names = await failedNames({ "POST /mcp": () => Response.json({}, { status: 401 }) });
    expect(names).toEqual(["MCP without a token is refused and points to the resource metadata"]);
  });

  it("fails when the dashboard API answers without a session", async () => {
    expect(await failedNames({ "GET /api/clients": () => Response.json({ clients: [] }) })).toEqual([
      "dashboard API without a session is refused",
    ]);
  });

  it("fails when a cross-site write is accepted", async () => {
    expect(await failedNames({ "POST /api/clients/probe/approve": () => Response.json({ client: {} }) })).toEqual([
      "a write from another site is refused",
    ]);
  });

  it("fails when a security header is missing", async () => {
    const names = await failedNames({
      "GET /": () => new Response("<html></html>", { headers: { "x-no-security-headers": "1" } }),
    });
    expect(names).toEqual(["security headers are set on the dashboard and the API"]);
  });

  it("fails when an unknown API path returns the dashboard page", async () => {
    const names = await failedNames({
      "GET /api/no-such-path": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    });
    expect(names).toEqual(["an unknown API path is JSON 404, not the dashboard page"]);
  });

  it("reports a network failure as a failed probe, not a crash", async () => {
    const failures = await runProbes(ORIGIN, async () => {
      throw new Error("offline");
    });
    expect(failures).toHaveLength(PROBES.length);
  });
});
