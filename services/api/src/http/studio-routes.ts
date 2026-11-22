import { type BrandKit, type BrandPage, type BrandSummary, CANON_SCOPES, type CanonScope, type ScopedCanon, type TastePage } from "@a11-wild/shared";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { AttentionService } from "../attention/service.js";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import { scopeOf } from "../taste/canon.js";
import { requireOwner, type SessionEnv } from "./guards.js";

const SCOPE = z.strictObject({ kind: z.enum(CANON_SCOPES), brandId: z.string().min(1).max(64).optional() });
const CANON = z.strictObject({ text: z.string().max(40_000), reason: z.string().max(500), scope: SCOPE.optional() });
const RESTORE = z.strictObject({ version: z.number().int().min(1), reason: z.string().min(1).max(500), scope: SCOPE.optional() });
const DECIDE = z.strictObject({ approve: z.boolean(), ownerSaid: z.string().trim().min(1).max(500) });
const NOTE = z.strictObject({ note: z.string().trim().min(1).max(500) });
const LEARNING_SHOWN = 50;
const SAID = z.strictObject({ ideaId: z.string().min(1).max(64), ownerSaid: z.string().min(1).max(1000) });
const CONCEPT_PICK = z.strictObject({ picks: z.array(SAID).length(3), passes: z.array(SAID).max(30).optional() });
const PICK = z.strictObject({ ideaId: z.string().min(1).max(64), imageId: z.string().min(1).max(64).nullable(), ownerSaid: z.string().min(1).max(2000) });

/** The dashboard's read of what the studio knows: brands, facts, truth sheets, taste and spend. */
export function studioRoutes(
  routes: Hono<SessionEnv>,
  deps: Deps,
  session: MiddlewareHandler<SessionEnv>,
  ownerWrite: readonly [MiddlewareHandler<SessionEnv>, MiddlewareHandler, MiddlewareHandler<SessionEnv>],
): void {
  const { brands, facts, truth, batches, ledger, canon, tasteLog, swipe, board, calibration, done, conceptBoard, conceptPicks, learning, proposals, brandNotes, made } = deps.studio;
  /** The scope a request names. A brand's scope names a brand the studio has. */
  async function scopeIn(input: { kind: CanonScope["kind"]; brandId?: string | undefined } | undefined): Promise<CanonScope> {
    const scope = scopeOf(input);
    if (scope.kind === "brand") await brands.brand(scope.brandId as string);
    return scope;
  }
  /** A refusal is written for the person: it says what to change. */
  const refused = (error: unknown) => {
    if (error instanceof Refusal) return { error: "refused", message: error.message };
    throw error;
  };
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
      canon: await canon.get({ kind: "brand", brandId }),
      canonVersions: await canon.versions({ kind: "brand", brandId }),
      notes: await brandNotes.list(brandId),
    };
    return c.json(page);
  });

  // What the owner chose for one brand. He types it himself, so the note is his own words.
  routes.post("/api/brands/:brandId/notes", ...ownerWrite, async (c) => {
    const body = NOTE.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the note, in 500 characters or fewer." }, 400);
    const brandId = c.req.param("brandId");
    if (!(await brands.brands()).some((kit) => kit.id === brandId)) return c.json({ error: "not_found" }, 404);
    const saved = await brandNotes.add({ brandId, note: body.data.note, ownerSaid: body.data.note, savedBy: c.get("session").email });
    log.info("brand_note_saved", { brandId, by: c.get("session").sub });
    return c.json(saved);
  });

  routes.get("/api/spend", session, async (c) => c.json(await ledger.summary()));

  /** The pictures made beside the ads kept. The owner's alone: it counts the work of his earlier tools too. */
  routes.get("/api/made", session, requireOwner, async (c) => c.json(await made.read()));

  routes.get("/api/taste", session, async (c) => {
    const page: TastePage = {
      canon: await canon.get(),
      versions: await canon.versions(),
      log: await tasteLog.list({ limit: 100 }),
      swipe: await swipe.search("", 100),
      canons: await scoped(),
      proposals: await Promise.all((await proposals.list()).map(async (proposal) => ({ ...proposal, scopeName: await nameOf(proposal.scope), current: await canon.get(proposal.scope) }))),
      learning: await Promise.all((await learning.list({ limit: LEARNING_SHOWN })).map(async (entry) => ({ ...entry, scopeName: await nameOf(entry.scope) }))),
    };
    return c.json(page);
  });

  async function nameOf(scope: CanonScope): Promise<string> {
    if (scope.kind === "owner") return "Your taste";
    if (scope.kind === "craft") return "Creative craft";
    if (scope.kind === "performance") return "Performance";
    return (await brands.brands()).find((kit) => kit.id === scope.brandId)?.name ?? "A brand that was removed";
  }

  /** Craft and performance always, and each brand that has rules of its own. */
  async function scoped(): Promise<ScopedCanon[]> {
    const scopes: CanonScope[] = [{ kind: "craft" }, { kind: "performance" }, ...(await brands.brands()).map((kit): CanonScope => ({ kind: "brand", brandId: kit.id }))];
    const all = await Promise.all(scopes.map(async (scope): Promise<ScopedCanon> => ({ scope, name: await nameOf(scope), canon: await canon.get(scope), versions: await canon.versions(scope) })));
    return all.filter((entry) => entry.scope.kind !== "brand" || entry.canon.version > 0);
  }

  routes.post("/api/taste/proposals/:id", ...ownerWrite, async (c) => {
    const body = DECIDE.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send your yes or no, and a line in your own words." }, 400);
    try {
      const decided = await proposals.decide({ id: c.req.param("id"), ...body.data, by: c.get("session").email });
      log.info("proposal_decided", { id: decided.proposal.id, status: decided.proposal.status, by: c.get("session").sub });
      return c.json(decided);
    } catch (error) {
      return c.json(refused(error), 400);
    }
  });

  routes.post("/api/taste/canon/restore", ...ownerWrite, async (c) => {
    const body = RESTORE.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the version to bring back and a reason." }, 400);
    try {
      const { scope, ...input } = body.data;
      const saved = await canon.restore({ ...input, by: c.get("session").email, scope: await scopeIn(scope) });
      log.info("canon_restored", { version: saved.version, from: input.version, scope: saved.scope?.kind ?? "owner", by: c.get("session").sub });
      return c.json(saved);
    } catch (error) {
      return c.json(refused(error), 400);
    }
  });

  routes.get("/api/taste/canon/:version", session, async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "not_found" }, 404);
    try {
      const kind = SCOPE.safeParse({ kind: c.req.query("kind") ?? "owner", ...(c.req.query("brandId") ? { brandId: c.req.query("brandId") } : {}) });
      if (!kind.success) return c.json({ error: "not_found" }, 404);
      return c.json(await canon.version(version, await scopeIn(kind.data)));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.post("/api/taste/canon", ...ownerWrite, async (c) => {
    const body = CANON.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the canon's text and a reason." }, 400);
    try {
      const { scope, ...input } = body.data;
      const saved = await canon.save({ ...input, by: c.get("session").email, scope: await scopeIn(scope) });
      log.info("canon_saved", { version: saved.version, scope: saved.scope?.kind ?? "owner", by: c.get("session").sub });
      return c.json(saved);
    } catch (error) {
      // A refusal is written for the person: it says what to change.
      if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
      throw error;
    }
  });

  const attention = new AttentionService({ ...deps.studio, approvals: deps.approvals, now: deps.now });

  /** What waits for the owner and what is in work. A member gets the batches only: the rest is the owner's. */
  routes.get("/api/attention", session, async (c) => c.json(await attention.read(c.get("session").role)));

  routes.get("/api/batches/:batchId/board", session, async (c) => {
    try {
      return c.json(await board.board(c.req.param("batchId")));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.get("/api/batches/:batchId/concepts", session, async (c) => {
    try {
      return c.json(await conceptBoard.show(c.req.param("batchId")));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.post("/api/batches/:batchId/concept-pick", ...ownerWrite, async (c) => {
    const body = CONCEPT_PICK.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Pick three concepts, and say why for each in your own words." }, 400);
    const { sub, email, role } = c.get("session");
    try {
      const { picks, passes } = body.data;
      const saved = await conceptPicks.save(c.req.param("batchId"), { picks, ...(passes ? { passes } : {}) }, { email, role });
      log.info("concept_pick_saved", { batch: c.req.param("batchId"), concepts: picks.map((pick) => pick.ideaId).join(","), by: sub });
      return c.json(saved);
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "refused", message: error.message }, 400);
      throw error;
    }
  });

  routes.get("/api/batches/:batchId/done", session, async (c) => {
    try {
      return c.json(await done.report(await batches.get(c.req.param("batchId"))));
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  routes.get("/api/calibration", session, async (c) => c.json(await calibration.report()));

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
