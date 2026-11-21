import { Hono } from "hono";
import type { Deps } from "../app.js";
import { challenge, protectedResourceMetadata } from "../auth/metadata.js";
import { findActiveUser } from "../auth/users.js";
import { log } from "../log.js";
import { rpcError, RPC_CODES } from "../mcp/server.js";

/** JSON-RPC code in the range the protocol leaves to servers. */
const NOT_ALLOWED = -32001;

export function mcpRoutes(deps: Deps): Hono {
  const { config } = deps;
  const routes = new Hono();

  const metadata = () => protectedResourceMetadata(config);
  routes.get("/.well-known/oauth-protected-resource", (c) => c.json(metadata()));
  routes.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(metadata()));

  routes.post("/mcp", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer +(\S+)$/i)?.[1];
    if (!token) {
      c.header("www-authenticate", challenge(config));
      return c.json({ error: "unauthorized" }, 401);
    }
    const verified = await deps.tokens.verify(token);
    if (!verified.ok) {
      log.warn("mcp_refused", { reason: verified.reason });
      c.header("www-authenticate", challenge(config, verified.error));
      return c.json({ error: verified.error }, verified.status);
    }

    const user = await findActiveUser(deps.table, verified.claims.sub);
    if (!user) {
      log.warn("mcp_refused", { reason: "not_invited", client: verified.claims.clientId });
      return c.json(rpcError(null, NOT_ALLOWED, "This account is not invited to the studio."), 403);
    }

    const { clientId } = verified.claims;
    const status = await deps.approvals.statusOf(clientId, user.email);
    if (status !== "approved") {
      log.warn("mcp_refused", { reason: `client_${status}`, client: clientId, user: user.sub });
      const message = {
        pending: `This client waits for the owner's approval. The owner approves it at ${config.publicOrigin}/connections and you then connect again.`,
        revoked: "The owner revoked this client.",
        unknown: "This client is not registered with the studio.",
      }[status];
      return c.json(rpcError(null, NOT_ALLOWED, message), 403);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, RPC_CODES.PARSE_ERROR, "The body is not JSON."), 400);
    }
    const reply = await deps.mcp.handle(body, { user, clientId });
    return reply === undefined ? c.body(null, 202) : c.json(reply);
  });

  // The server opens no event stream and keeps no session, so only POST exists.
  routes.all("/mcp", (c) => {
    c.header("allow", "POST");
    return c.json({ error: "method_not_allowed" }, 405);
  });

  return routes;
}
