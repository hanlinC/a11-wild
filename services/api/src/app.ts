import { Hono } from "hono";
import type { ClientApprovals } from "./auth/clients.js";
import type { DashboardSignIn } from "./auth/oauth.js";
import type { AccessTokenVerifier } from "./auth/token.js";
import type { Config } from "./config.js";
import { apiRoutes } from "./http/api-routes.js";
import { authRoutes } from "./http/auth-routes.js";
import { mcpRoutes } from "./http/mcp-routes.js";
import { log } from "./log.js";
import type { McpServer } from "./mcp/server.js";
import type { Table } from "./store/table.js";

/** Everything a request needs. Tests pass in-memory versions. */
export interface Deps {
  config: Config;
  table: Table;
  tokens: AccessTokenVerifier;
  approvals: ClientApprovals;
  signIn: DashboardSignIn;
  mcp: McpServer;
  now: () => Date;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
  });

  app.get("/api/health", (c) => c.json({ ok: true, buildId: deps.config.buildId }));
  app.route("/", mcpRoutes(deps));
  app.route("/", authRoutes(deps));
  app.route("/", apiRoutes(deps));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    log.error("request_failed", { path: c.req.path, name: error.name });
    return c.json({ error: "server_error" }, 500);
  });

  return app;
}
