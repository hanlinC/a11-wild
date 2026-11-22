#!/usr/bin/env node
// Checks the live studio from outside, without signing in.
//
//   npm run probe -- https://<public address>
import { pathToFileURL } from "node:url";

/** Each probe returns undefined when it passes, or a short reason when it fails. */
const WRONG_TOKEN = "A".repeat(43);
const WRONG_REF = "0".repeat(24);
/** What a link with a wrong token must refuse, each as if the link did not exist. */
export const CLIENT_LINK_WRITES = [`/api/client/${WRONG_TOKEN}/packs/${WRONG_REF}/comments`, `/api/client/${WRONG_TOKEN}/packs/${WRONG_REF}/uploads`, `/api/pack/${WRONG_TOKEN}/comments`];
export const PORTAL_READS = ["/api/portal", "/api/packs/none/uploads/none/table"];
export const PORTAL_WRITES = ["/api/portal/none/link", "/api/packs/none/comments/none"];
export const OUTREACH_READS = ["/api/outreach/today", "/api/outreach/prospects", "/api/outreach/prospects/00001", "/api/outreach/templates"];
export const OUTREACH_WRITES = [
  ...["ad", "sent", "unsent", "reply", "answered", "optout", "stage", "note", "channel", "kind", "choose", "remove"].map((action) => `/api/outreach/prospects/00001/${action}`),
  "/api/outreach/templates",
  "/api/outreach/daily",
  "/api/outreach/test-prospect",
];

export const PROBES = [
  {
    name: "health answers",
    async run(origin, fetchFn) {
      const response = await fetchFn(`${origin}/api/health`);
      const body = await response.json().catch(() => undefined);
      if (response.status !== 200 || body?.ok !== true) return `status ${response.status}`;
    },
  },
  {
    name: "MCP without a token is refused and points to the resource metadata",
    async run(origin, fetchFn) {
      const response = await fetchFn(`${origin}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      if (response.status !== 401) return `status ${response.status}`;
      const challenge = response.headers.get("www-authenticate") ?? "";
      if (!challenge.includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`)) {
        return "no resource_metadata in WWW-Authenticate";
      }
    },
  },
  {
    name: "resource metadata names this server",
    async run(origin, fetchFn) {
      const response = await fetchFn(`${origin}/.well-known/oauth-protected-resource/mcp`);
      const body = await response.json().catch(() => undefined);
      if (response.status !== 200 || body?.resource !== `${origin}/mcp`) return `status ${response.status}`;
      if (!Array.isArray(body.authorization_servers) || body.authorization_servers.length !== 1) {
        return "authorization_servers is not one entry";
      }
    },
  },
  {
    name: "dashboard API without a session is refused",
    async run(origin, fetchFn) {
      for (const path of ["/api/me", "/api/clients", "/api/brands", "/api/spend", "/api/taste", "/api/calibration", "/api/packs", "/api/batches/none/board", "/api/batches/none/done"]) {
        const response = await fetchFn(`${origin}${path}`);
        if (response.status !== 401) return `${path} status ${response.status}`;
      }
    },
  },
  {
    name: "the outreach pages and their writes are refused without a session",
    async run(origin, fetchFn) {
      for (const path of OUTREACH_READS) {
        const response = await fetchFn(`${origin}${path}`);
        if (response.status !== 401) return `${path} status ${response.status}`;
      }
      for (const path of OUTREACH_WRITES) {
        // Sent from the studio's own origin, so the answer shows the session check and not the origin check.
        const response = await fetchFn(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
        if (response.status !== 401) return `POST ${path} status ${response.status}`;
      }
    },
  },
  {
    name: "a write from another site is refused",
    async run(origin, fetchFn) {
      const response = await fetchFn(`${origin}/api/clients/probe/approve`, {
        method: "POST",
        headers: { origin: "https://probe.invalid" },
      });
      if (response.status !== 401 && response.status !== 403) return `status ${response.status}`;
    },
  },
  {
    name: "security headers are set on the dashboard and the API",
    async run(origin, fetchFn) {
      for (const path of ["/", "/api/health"]) {
        const { headers } = await fetchFn(`${origin}${path}`);
        const missing = [
          ["strict-transport-security", "max-age="],
          ["content-security-policy", "frame-ancestors 'none'"],
          ["x-content-type-options", "nosniff"],
          ["x-frame-options", "DENY"],
        ].filter(([name, part]) => !(headers.get(name) ?? "").includes(part));
        if (missing.length > 0) return `${path} lacks ${missing.map(([name]) => name).join(", ")}`;
      }
    },
  },
  {
    name: "a pack link with a wrong token opens nothing and takes no file",
    async run(origin, fetchFn) {
      // A token of the right shape that no pack has. A wrong link must look the same as no link.
      const token = "A".repeat(43);
      const page = await fetchFn(`${origin}/api/pack/${token}`);
      if (page.status !== 404) return `page status ${page.status}`;
      if (!(page.headers.get("x-robots-tag") ?? "").includes("noindex")) return "no noindex on the pack answer";
      const upload = await fetchFn(`${origin}/api/pack/${token}/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "probe.png", type: "image/png", bytes: 1 }),
      });
      if (upload.status !== 404) return `upload status ${upload.status}`;
    },
  },
  {
    name: "a client link with a wrong token opens nothing and takes no comment",
    async run(origin, fetchFn) {
      const token = "A".repeat(43);
      const page = await fetchFn(`${origin}/api/client/${token}`);
      if (page.status !== 404) return `page status ${page.status}`;
      if (!(page.headers.get("x-robots-tag") ?? "").includes("noindex")) return "no noindex on the client answer";
      for (const path of CLIENT_LINK_WRITES) {
        const response = await fetchFn(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "probe" }) });
        if (response.status !== 404) return `POST ${path} status ${response.status}`;
      }
    },
  },
  {
    name: "the owner's client pages and their writes are refused without a session",
    async run(origin, fetchFn) {
      for (const path of PORTAL_READS) {
        const response = await fetchFn(`${origin}${path}`);
        if (response.status !== 401) return `${path} status ${response.status}`;
      }
      for (const path of PORTAL_WRITES) {
        const response = await fetchFn(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
        if (response.status !== 401) return `POST ${path} status ${response.status}`;
      }
    },
  },
  {
    name: "an unknown API path is JSON 404, not the dashboard page",
    async run(origin, fetchFn) {
      const response = await fetchFn(`${origin}/api/no-such-path`);
      if (response.status !== 404) return `status ${response.status}`;
      if (!(response.headers.get("content-type") ?? "").includes("application/json")) return "not JSON";
    },
  },
];

/** Runs every probe and returns the failures as `{ name, reason }`. */
export async function runProbes(origin, fetchFn = fetch) {
  const failures = [];
  for (const probe of PROBES) {
    let reason;
    try {
      reason = await probe.run(origin, fetchFn);
    } catch (error) {
      reason = `request failed: ${error instanceof Error ? error.message : "unknown"}`;
    }
    if (reason) failures.push({ name: probe.name, reason });
  }
  return failures;
}

async function main() {
  const origin = process.argv[2]?.replace(/\/$/, "");
  if (!origin?.startsWith("https://")) {
    console.error("Usage: npm run probe -- https://<public address>");
    process.exit(1);
  }
  const failures = await runProbes(origin);
  for (const failure of failures) console.error(`FAIL  ${failure.name}: ${failure.reason}`);
  console.log(`${PROBES.length - failures.length} of ${PROBES.length} probes passed`);
  if (failures.length > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
