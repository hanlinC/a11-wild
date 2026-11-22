import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OUTREACH_READS, OUTREACH_WRITES, PROBES, runProbes } from "./probe.mjs";

const ORIGIN = "https://studio.example.com";
const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const signedOut = () => Response.json({ error: "signed_out" }, { status: 401 });

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
    "GET /api/calibration": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/packs": () => Response.json({ error: "signed_out" }, { status: 401 }),
    [`GET /api/pack/${"A".repeat(43)}`]: () => Response.json({ error: "not_found" }, { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } }),
    [`POST /api/pack/${"A".repeat(43)}/uploads`]: () => Response.json({ error: "not_found" }, { status: 404 }),
    "GET /api/batches/none/board": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/batches/none/done": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "POST /api/clients/probe/approve": () => Response.json({ error: "signed_out" }, { status: 401 }),
    "GET /api/no-such-path": () => Response.json({ error: "not_found" }, { status: 404 }),
    ...Object.fromEntries(OUTREACH_READS.map((path) => [`GET ${path}`, signedOut])),
    ...Object.fromEntries(OUTREACH_WRITES.map((path) => [`POST ${path}`, signedOut])),
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

  it("fails when an outreach page answers without a session", async () => {
    expect(await failedNames({ "GET /api/outreach/prospects/00001": () => Response.json({ prospect: {} }) })).toEqual([
      "the outreach pages and their writes are refused without a session",
    ]);
  });

  it("fails when an outreach write is not refused as signed out", async () => {
    for (const status of [200, 403]) {
      expect(await failedNames({ "POST /api/outreach/prospects/00001/optout": () => Response.json({}, { status }) })).toEqual([
        "the outreach pages and their writes are refused without a session",
      ]);
    }
  });

  it("probes every outreach route the server has", async () => {
    const source = await readFile(new URL("../services/api/src/http/outreach-routes.ts", import.meta.url), "utf8");
    const literal = [...source.matchAll(/routes\.(get|post)\("([^"]+)"/g)].map(([, method, path]) => `${method} ${path.replace(":id", "00001")}`);
    const actions = [...source.matchAll(/^\s*write\("([a-z]+)"/gm)].map(([, action]) => `post /api/outreach/prospects/00001/${action}`);
    const served = [...literal, ...actions];
    const probed = [...OUTREACH_READS.map((path) => `get ${path}`), ...OUTREACH_WRITES.map((path) => `post ${path}`)];
    expect(served.length).toBeGreaterThan(0);
    expect(served.sort()).toEqual(probed.sort());
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

  it("fails when a wrong pack token opens a pack, or takes a file", async () => {
    const name = "a pack link with a wrong token opens nothing and takes no file";
    const token = "A".repeat(43);
    expect(await failedNames({ [`GET /api/pack/${token}`]: () => Response.json({ brand: "x" }) })).toEqual([name]);
    expect(await failedNames({ [`GET /api/pack/${token}`]: () => Response.json({ error: "not_found" }, { status: 404 }) })).toEqual([name]);
    expect(await failedNames({ [`POST /api/pack/${token}/uploads`]: () => Response.json({ putUrl: "https://x" }) })).toEqual([name]);
  });

  it("reports a network failure as a failed probe, not a crash", async () => {
    const failures = await runProbes(ORIGIN, async () => {
      throw new Error("offline");
    });
    expect(failures).toHaveLength(PROBES.length);
  });
});
