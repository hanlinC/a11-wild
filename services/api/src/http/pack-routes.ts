import type { Hono, MiddlewareHandler } from "hono";
import type { Deps } from "../app.js";
import type { SessionEnv } from "./guards.js";

/**
 * The client's side of a pack, and the owner's list of packs.
 * `/api/pack/<token>` needs no sign-in: the token is the key. It shows that one pack and names nothing else of the studio.
 */
export function packRoutes(routes: Hono<SessionEnv>, deps: Deps, session: MiddlewareHandler<SessionEnv>): void {
  const { pack } = deps.studio;

  routes.get("/api/pack/:token", async (c) => {
    // No search engine keeps the page, and no other site learns the link from a click on it.
    c.header("x-robots-tag", "noindex, nofollow");
    c.header("referrer-policy", "no-referrer");
    const view = await pack.view(c.req.param("token"));
    // A wrong, old or badly shaped token gets the same answer as a page that never was.
    return view ? c.json(view) : c.json({ error: "not_found" }, 404);
  });

  routes.get("/api/packs", session, async (c) => c.json({ packs: await pack.summaries() }));
}
