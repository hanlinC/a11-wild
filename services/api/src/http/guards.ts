import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readSession, SESSION_COOKIE, type Session } from "../auth/session.js";
import { findActiveUser } from "../auth/users.js";
import type { Deps } from "../app.js";

export type SessionEnv = { Variables: { session: Session } };

/**
 * Lets the request pass only with a live dashboard session. The person is read
 * again each time, so disabling them or changing their role takes effect at once.
 */
export function requireSession(deps: Deps): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const session = await readSession(deps.table, getCookie(c, SESSION_COOKIE), deps.now());
    const user = session && (await findActiveUser(deps.table, session.sub));
    if (!user) return c.json({ error: "signed_out" }, 401);
    c.set("session", { sub: user.sub, email: user.email, role: user.role });
    await next();
  };
}

export const requireOwner: MiddlewareHandler<SessionEnv> = async (c, next) => {
  if (c.get("session").role !== "owner") return c.json({ error: "owner_only" }, 403);
  await next();
};

/**
 * A write must come from the dashboard's own pages. The session cookie is
 * SameSite=Strict already; this check is the second lock.
 */
export function requireSameOrigin(deps: Deps): MiddlewareHandler {
  return async (c: Context, next) => {
    if (c.req.header("origin") !== deps.config.publicOrigin) return c.json({ error: "bad_origin" }, 403);
    await next();
  };
}
