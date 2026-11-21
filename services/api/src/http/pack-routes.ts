import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import type { SessionEnv } from "./guards.js";

const FILE = z.strictObject({ name: z.string().min(1).max(300), type: z.string().min(1).max(120), bytes: z.number() });

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

  // The client says which file is coming and gets one link to send it to. The file itself never passes through the studio's server.
  routes.post("/api/pack/:token/uploads", async (c) => {
    c.header("referrer-policy", "no-referrer");
    const body = FILE.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send a JPEG or PNG screenshot, or a CSV or XLSX export." }, 400);
    try {
      const taken = await pack.upload(c.req.param("token"), body.data);
      if (!taken) return c.json({ error: "not_found" }, 404);
      log.info("pack_upload_started", { upload: taken.upload.id, type: body.data.type, bytes: body.data.bytes });
      return c.json(taken);
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
      throw error;
    }
  });

  routes.get("/api/packs", session, async (c) => c.json({ packs: await pack.summaries() }));
}
