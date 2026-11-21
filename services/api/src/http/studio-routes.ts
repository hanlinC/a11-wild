import type { BatchSummary, BrandKit, BrandPage, BrandSummary, TastePage } from "@a11-wild/shared";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import type { SessionEnv } from "./guards.js";

const CANON = z.strictObject({ text: z.string().max(40_000), reason: z.string().max(500) });
const PICK = z.strictObject({ ideaId: z.string().min(1).max(64), imageId: z.string().min(1).max(64).nullable(), ownerSaid: z.string().min(1).max(2000) });

/** The dashboard's read of what the studio knows: brands, facts, truth sheets, taste and spend. */
export function studioRoutes(
  routes: Hono<SessionEnv>,
  deps: Deps,
  session: MiddlewareHandler<SessionEnv>,
  ownerWrite: readonly [MiddlewareHandler<SessionEnv>, MiddlewareHandler, MiddlewareHandler<SessionEnv>],
): void {
  const { brands, facts, truth, batches, ledger, canon, tasteLog, swipe, board } = deps.studio;
  const logoUrl = (brand: BrandKit) => (brand.logo ? deps.pictures.viewUrl(brand.logo.key) : null);

  routes.get("/api/brands", session, async (c) => {
    const list = await Promise.all(
      (await brands.brands()).map(
        async (brand): Promise<BrandSummary> => ({
          brand,
          logoUrl: await logoUrl(brand),
          products: (await brands.products(brand.id)).map(({ id, name }) => ({ id, name })),
        }),
      ),
    );
    return c.json({ brands: list.sort((a, b) => a.brand.name.localeCompare(b.brand.name)) });
  });

  routes.get("/api/brands/:brandId", session, async (c) => {
    const brandId = c.req.param("brandId");
    const brand = (await brands.brands()).find((kit) => kit.id === brandId);
    if (!brand) return c.json({ error: "not_found" }, 404);
    const products = await Promise.all(
      (await brands.products(brandId)).map(async (product) => ({
        product: { ...product, photos: await Promise.all(product.photos.map(async (photo) => ({ ...photo, viewUrl: await deps.pictures.viewUrl(photo.key) }))) },
        facts: await facts.list(product.id),
        truthSheet: (await truth.get(product.id)) ?? null,
      })),
    );
    const page: BrandPage = {
      brand,
      logoUrl: await logoUrl(brand),
      products,
      batches: (await batches.list()).filter((batch) => batch.brandId === brandId),
    };
    return c.json(page);
  });

  routes.get("/api/spend", session, async (c) => c.json(await ledger.summary()));

  routes.get("/api/taste", session, async (c) => {
    const page: TastePage = {
      canon: await canon.get(),
      versions: await canon.versions(),
      log: await tasteLog.list({ limit: 100 }),
      swipe: await swipe.search("", 100),
    };
    return c.json(page);
  });

  routes.get("/api/taste/canon/:version", session, async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "not_found" }, 404);
    try {
      return c.json(await canon.version(version));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.post("/api/taste/canon", ...ownerWrite, async (c) => {
    const body = CANON.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the canon's text and a reason." }, 400);
    try {
      const saved = await canon.save({ ...body.data, by: c.get("session").email });
      log.info("canon_saved", { version: saved.version, by: c.get("session").sub });
      return c.json(saved);
    } catch (error) {
      // A refusal is written for the person: it says what to change.
      if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
      throw error;
    }
  });

  routes.get("/api/batches", session, async (c) => {
    const list = await Promise.all(
      (await batches.list()).map(async (batch): Promise<BatchSummary> => {
        const [brand, product] = await Promise.all([brands.brand(batch.brandId), brands.product(batch.productId)]);
        return { batch, brand: { id: brand.id, name: brand.name }, product: { id: product.id, name: product.name } };
      }),
    );
    return c.json({ batches: list });
  });

  routes.get("/api/batches/:batchId/board", session, async (c) => {
    try {
      return c.json(await board.board(c.req.param("batchId")));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.post("/api/batches/:batchId/picks", ...ownerWrite, async (c) => {
    const body = PICK.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Choose a draft or pass, and say why in your own words." }, 400);
    const { sub, email, role } = c.get("session");
    try {
      const saved = await board.pick(c.req.param("batchId"), body.data, { email, role });
      log.info("pick_saved", { batch: c.req.param("batchId"), idea: body.data.ideaId, by: sub });
      return c.json(saved);
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
      throw error;
    }
  });
}
