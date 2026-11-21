import { Hono } from "hono";
import type { Me } from "@a11-wild/shared";
import type { Deps } from "../app.js";
import { log } from "../log.js";
import { requireOwner, requireSameOrigin, requireSession, type SessionEnv } from "./guards.js";
import { packRoutes } from "./pack-routes.js";
import { studioRoutes } from "./studio-routes.js";

export function apiRoutes(deps: Deps): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();
  const session = requireSession(deps);
  const ownerWrite = [session, requireSameOrigin(deps), requireOwner] as const;

  routes.get("/api/me", session, (c) => {
    const { email, role } = c.get("session");
    return c.json({ email, role } satisfies Me);
  });

  routes.get("/api/clients", session, async (c) => c.json({ clients: await deps.approvals.list() }));

  routes.post("/api/clients/:clientId/approve", ...ownerWrite, async (c) => {
    const record = await deps.approvals.approve(c.req.param("clientId"));
    if (!record) return c.json({ error: "not_found" }, 404);
    log.info("client_approved", { client: record.clientId, by: c.get("session").sub });
    return c.json({ client: record });
  });

  routes.post("/api/clients/:clientId/revoke", ...ownerWrite, async (c) => {
    const record = await deps.approvals.revoke(c.req.param("clientId"));
    if (!record) return c.json({ error: "not_found" }, 404);
    log.info("client_revoked", { client: record.clientId, by: c.get("session").sub });
    return c.json({ client: record });
  });

  studioRoutes(routes, deps, session, ownerWrite);
  packRoutes(routes, deps, session);

  return routes;
}
