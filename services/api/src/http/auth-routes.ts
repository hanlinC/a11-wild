import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Deps } from "../app.js";
import {
  authorizeUrl,
  decodeLoginState,
  encodeLoginState,
  LOGIN_COOKIE,
  LOGIN_STATE_SECONDS,
  logoutUrl,
  newLoginState,
} from "../auth/oauth.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../auth/session.js";
import { findActiveUser } from "../auth/users.js";
import { requireSameOrigin } from "./guards.js";

const COOKIE_BASE = { httpOnly: true, secure: true, path: "/" } as const;

export function authRoutes(deps: Deps): Hono {
  const { config } = deps;
  const routes = new Hono();

  routes.get("/auth/login", (c) => {
    const login = newLoginState();
    // Lax, not Strict: the callback below arrives as a navigation from the sign-in site.
    setCookie(c, LOGIN_COOKIE, encodeLoginState(login), {
      ...COOKIE_BASE,
      sameSite: "Lax",
      maxAge: LOGIN_STATE_SECONDS,
    });
    return c.redirect(authorizeUrl(config, login), 302);
  });

  routes.get("/auth/callback", async (c) => {
    const login = decodeLoginState(getCookie(c, LOGIN_COOKIE));
    deleteCookie(c, LOGIN_COOKIE, COOKIE_BASE);
    const code = c.req.query("code");
    if (!login || !code || c.req.query("state") !== login.state) {
      return c.redirect("/signed-out?reason=failed", 302);
    }

    const identity = await deps.signIn.identify(code, login);
    if (!identity) return c.redirect("/signed-out?reason=failed", 302);
    const user = await findActiveUser(deps.table, identity.sub);
    if (!user) return c.redirect("/signed-out?reason=denied", 302);

    const sessionId = await createSession(deps.table, config, user, deps.now());
    setCookie(c, SESSION_COOKIE, sessionId, {
      ...COOKIE_BASE,
      sameSite: "Strict",
      maxAge: config.sessionSeconds,
    });
    return c.redirect("/", 302);
  });

  routes.post("/auth/logout", requireSameOrigin(deps), async (c) => {
    await deleteSession(deps.table, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, COOKIE_BASE);
    // The page then goes to this address, which ends the sign-in site's own session too.
    return c.json({ redirect: logoutUrl(config) });
  });

  return routes;
}
