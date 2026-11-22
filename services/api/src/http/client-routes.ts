import type { OwnerClient, Pack, PackVersion } from "@a11-wild/shared";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import { requireOwner, type SessionEnv } from "./guards.js";

const FILE = z.strictObject({ name: z.string().min(1).max(300), type: z.string().min(1).max(120), bytes: z.number() });
// The text is checked by the comment service, which also says in plain words what is wrong with it.
const COMMENT = z.strictObject({ text: z.unknown(), adName: z.unknown().optional(), change: z.unknown().optional() });
const LINK = z.strictObject({ action: z.enum(["make", "replace", "off"]) });
const MARK = z.union([z.strictObject({ hidden: z.boolean() }), z.strictObject({ status: z.string().max(20) })]);

type Found = { pack: Pack; version: PackVersion };

/**
 * What a client does through a link, and what the owner does with it.
 *
 * A link needs no sign-in: the token is the key. `/api/pack/<token>` opens one pack, `/api/client/<token>` opens every pack of one brand,
 * and a pack on that page is named by a reference that is not its id. A wrong, old or badly shaped token gets the same answer as a page that never was.
 * The owner's routes need the dashboard session in the owner's role; a write also needs the dashboard's own origin.
 */
export function clientRoutes(
  routes: Hono<SessionEnv>,
  deps: Deps,
  session: MiddlewareHandler<SessionEnv>,
  ownerWrite: readonly [MiddlewareHandler<SessionEnv>, MiddlewareHandler, MiddlewareHandler<SessionEnv>],
): void {
  const { pack, packs, clients, comments, uploads, brands } = deps.studio;
  const { pictures } = deps;
  const notFound = (c: Context) => c.json({ error: "not_found" }, 404);
  /** No search engine keeps the page, and no other site learns the link from a click on it. */
  const quiet = (c: Context) => {
    c.header("x-robots-tag", "noindex, nofollow");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "no-store");
  };
  const refusal = (c: Context, error: unknown) => {
    if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
    throw error;
  };

  routes.get("/api/client/:token", async (c) => {
    quiet(c);
    const view = await clients.view(c.req.param("token"));
    return view ? c.json(view) : notFound(c);
  });

  /** The same four things a client does with one pack, behind either kind of link. */
  function packActions(prefix: string, find: (c: Context) => Promise<Found | undefined>) {
    // An address that downloads one ad, made at the click and good for a few minutes.
    routes.get(`${prefix}/download/:ad`, async (c) => {
      quiet(c);
      const found = await find(c);
      const ad = Number(c.req.param("ad"));
      const url = found && Number.isInteger(ad) ? await pack.downloadOf(found.pack, found.version, ad, c.req.query("format")) : undefined;
      return url ? c.json({ url }) : notFound(c);
    });

    routes.post(`${prefix}/comments`, async (c) => {
      quiet(c);
      // The link is read first: a wrong link answers the same whatever is sent with it.
      const found = await find(c);
      if (!found) return notFound(c);
      const body = COMMENT.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) return c.json({ error: "bad_request", message: "Write your comment as plain text." }, 400);
      try {
        const comment = await comments.send(found.pack, found.version, body.data);
        log.info("pack_comment", { change: comment.change !== undefined });
        return c.json({ comment });
      } catch (error) {
        return refusal(c, error);
      }
    });

    // The client says which file is coming and gets one address to send it to. The file itself never passes through the studio's server.
    routes.post(`${prefix}/uploads`, async (c) => {
      quiet(c);
      const found = await find(c);
      if (!found) return notFound(c);
      const body = FILE.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) return c.json({ error: "bad_request", message: "Send a JPEG or PNG screenshot, or a CSV export." }, 400);
      try {
        const taken = await pack.uploadTo(found.pack, body.data);
        log.info("pack_upload_started", { upload: taken.upload.id, type: body.data.type, bytes: body.data.bytes });
        return c.json(taken);
      } catch (error) {
        return refusal(c, error);
      }
    });

    // The page says the file is sent. The studio reads it now, keeps it or deletes it, and tells the page which.
    routes.post(`${prefix}/uploads/:id/done`, async (c) => {
      quiet(c);
      const found = await find(c);
      if (!found) return notFound(c);
      try {
        const settled = await uploads.done(found.pack, c.req.param("id"));
        log.info("pack_upload_settled", { upload: c.req.param("id"), state: settled.state });
        return c.json(settled);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  packActions("/api/pack/:token", (c) => pack.opened(c.req.param("token") ?? ""));
  packActions("/api/client/:token/packs/:ref", (c) => clients.find(c.req.param("token") ?? "", c.req.param("ref") ?? ""));

  const ownerRead = [session, requireOwner] as const;

  /** Every brand that has a pack or a client link, with what its client wrote and sent. */
  routes.get("/api/portal", ...ownerRead, async (c) => {
    const [all, links] = await Promise.all([packs.all(), packs.clientLinks()]);
    const byBrand = new Map<string, OwnerClient["packs"]>();
    for (const link of links) byBrand.set(link.brandId, []);
    const shown = await Promise.all(
      all.map(async (one) => {
        const version = await pack.current(one);
        if (!version) return undefined;
        const [brandId, view, written, sent] = await Promise.all([pack.brandOf(one), pack.viewOf(one, version), comments.all(one.id).then((all) => pack.onCurrentAds(one, version, all)), uploads.list(one.id)]);
        return {
          brandId,
          createdAt: one.createdAt,
          pack: {
            packId: one.id,
            product: view.product,
            version: version.version,
            at: version.at,
            example: one.example !== undefined,
            ads: view.ads.map((ad) => ({ adName: ad.adName, viewUrl: ad.viewUrl })),
            comments: written,
            uploads: await Promise.all(sent.map(async ({ key, ...upload }) => ({ ...upload, ...(upload.state === "checked" && upload.type !== "text/csv" ? { openUrl: await pictures.viewUrl(key) } : {}) }))),
          },
        };
      }),
    );
    for (const entry of shown.filter((value) => value !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      byBrand.set(entry.brandId, [...(byBrand.get(entry.brandId) ?? []), entry.pack]);
    }
    const list = await Promise.all(
      [...byBrand].map(async ([brandId, ofBrand]): Promise<OwnerClient> => {
        const link = links.find((entry) => entry.brandId === brandId);
        return { brand: { id: brandId, name: (await brands.brand(brandId)).name }, ...(link ? { link } : {}), packs: ofBrand };
      }),
    );
    return c.json({ clients: list.sort((a, b) => a.brand.name.localeCompare(b.brand.name)) });
  });

  // Makes, replaces or turns off the one link of a brand. A new link is in the answer once and is kept nowhere.
  routes.post("/api/portal/:brandId/link", ...ownerWrite, async (c) => {
    const body = LINK.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const brandId = c.req.param("brandId");
    const by = c.get("session").email;
    try {
      c.header("cache-control", "no-store");
      if (body.data.action === "off") return c.json({ link: await clients.turnOff(brandId, by) });
      const made = body.data.action === "make" ? await clients.make(brandId, by) : await clients.replace(brandId, by);
      log.info("client_link", { action: body.data.action });
      return c.json({ url: made.link });
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Hides a comment from the client's page, or sets where a change request stands.
  routes.post("/api/packs/:packId/comments/:id", ...ownerWrite, async (c) => {
    const body = MARK.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const one = await packs.get(c.req.param("packId"));
    if (!one) return notFound(c);
    try {
      const comment = "hidden" in body.data ? await comments.hide(one.id, c.req.param("id"), body.data.hidden) : await comments.setStatus(one, c.req.param("id"), body.data.status);
      const version = await pack.current(one);
      return c.json({ comment: version ? (await pack.onCurrentAds(one, version, [comment]))[0] : comment });
    } catch (error) {
      return refusal(c, error);
    }
  });

  // A client's CSV as a table of text. The file itself is never given to the dashboard.
  routes.get("/api/packs/:packId/uploads/:id/table", ...ownerRead, async (c) => {
    try {
      return c.json(await uploads.table(c.req.param("packId"), c.req.param("id")));
    } catch (error) {
      return refusal(c, error);
    }
  });
}
