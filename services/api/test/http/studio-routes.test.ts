import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { PAGE, savedProduct, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, json, ORIGIN, sessionCookie, type Studio } from "../helpers/deps.js";
import { extractReply } from "../helpers/parallel.js";

let studio: Studio;
let cookie: string;

beforeEach(async () => {
  studio = await createStudio({ parallel: extractReply({ [PAGE]: "Seaweed crisps. Net weight: 40 g." }) });
  await approvedClient(studio);
  cookie = await sessionCookie(studio);
});

const get = (path: string, headers: Record<string, string> = { cookie }) => studio.app.request(path, { headers });
const post = (path: string, body: unknown, as = cookie, origin: string | undefined = ORIGIN) =>
  studio.app.request(path, {
    method: "POST",
    headers: { cookie: as, "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
const saveCanon = (body: unknown, as = cookie, origin: string | undefined = ORIGIN) => post("/api/taste/canon", body, as, origin);
const rules = { rulesVersion: RULES_VERSION };
const seen = (scope: object, observation: string) => ({
  ...rules,
  observation,
  source: "The owner's words on the board.",
  scope,
  lesson: "The food is the picture. No prop beside it.",
  evidence: 1,
  confidence: "medium",
  examples: ["Idea 2, draft 1."],
  counterexamples: [],
  expectedEffect: "Fewer drafts passed on for clutter.",
});

describe("studio routes", () => {
  it("answers 401 without a session on every route", async () => {
    for (const path of ["/api/brands", "/api/brands/x", "/api/attention", "/api/spend", "/api/taste", "/api/taste/canon/1", "/api/calibration", "/api/batches/x/done"]) {
      expect((await get(path, {})).status, path).toBe(401);
    }
    expect((await saveCanon({ text: "x", reason: "y" }, "")).status).toBe(401);
  });

  it("gives a brand with its products, facts, truth sheet and batches", async () => {
    const { brand, product } = await savedProduct(studio);
    await callTool(studio, "facts_save", { productId: product.id, facts: [{ claim: "A pack holds 40 g", quote: "Net weight: 40 g.", url: PAGE }] });
    const batchId = (await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id })).value.batch.id;
    await callTool(studio, "truth_save", { batchId, ...sheet, measures: [{ name: "pack height", value: 180, unit: "mm" }] });

    const list = await json(await get("/api/brands"));
    expect(list.brands).toEqual([{ brand: expect.objectContaining({ name: "WonGi" }), logoUrl: null, products: [{ id: product.id, name: "Seaweed crisps" }] }]);

    const page = await json(await get(`/api/brands/${brand.id}`));
    expect(page.products[0].facts).toEqual([expect.objectContaining({ quote: "Net weight: 40 g.", url: PAGE })]);
    expect(page.products[0].truthSheet.measures).toEqual([{ name: "pack height", value: 180, unit: "mm", status: "unverified" }]);
    expect(page.products[0].product.photos[0].viewUrl).toEqual(expect.stringContaining("products/p/food.jpg"));
    expect(page.batches).toEqual([expect.objectContaining({ id: batchId, state: "truth" })]);
    expect((await json(await get("/api/attention"))).batches).toEqual([
      expect.objectContaining({ batch: expect.objectContaining({ id: batchId, state: "truth" }), brand: { id: brand.id, name: "WonGi" }, product: { id: product.id, name: "Seaweed crisps" }, who: "agent" }),
    ]);
    expect((await get("/api/brands/nope")).status).toBe(404);
  });

  it("gives the month's total, both caps and each line of spend", async () => {
    await callTool(studio, "page_read", { url: PAGE, batchId: "b1" });
    const spend = await json(await get("/api/spend"));
    expect(spend).toMatchObject({ monthUsd: 0.001, monthCapUsd: 25, batchCapUsd: 5, lines: [{ batchId: "b1", service: "parallel", usd: 0.001, status: "spent" }] });
  });

  it("lets the owner save the canon with a reason, and keeps the old version readable", async () => {
    expect((await saveCanon({ text: "One clever object.", reason: "First canon." })).status).toBe(200);
    const second = await saveCanon({ text: "One clever object. No clutter.", reason: "He passed on a busy draft." });
    expect(await json(second)).toMatchObject({ version: 2, savedBy: "owner@example.com" });

    const taste = await json(await get("/api/taste"));
    expect(taste.canon.text).toBe("One clever object. No clutter.");
    expect(taste.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await json(await get("/api/taste/canon/1"))).text).toBe("One clever object.");
    expect((await get("/api/taste/canon/9")).status).toBe(404);
  });

  it("refuses a canon save with no reason and says why", async () => {
    const refused = await saveCanon({ text: "One clever object.", reason: " " });
    expect(refused.status).toBe(400);
    expect(await json(refused)).toEqual({ error: "refused", message: expect.stringMatching(/needs a reason/) });
    expect((await saveCanon({ text: "x", reason: "y", extra: 1 })).status).toBe(400);
  });

  it("refuses a canon save from a member and from another site", async () => {
    expect((await saveCanon({ text: "Mine.", reason: "Because." }, await sessionCookie(studio, "member"))).status).toBe(403);
    expect((await saveCanon({ text: "Mine.", reason: "Because." }, cookie, "https://evil.example")).status).toBe(403);
    expect((await json(await get("/api/taste"))).canon.version).toBe(0);
  });

  it("keeps each canon apart, and brings an earlier version back as a new one", async () => {
    const { brand } = await savedProduct(studio);
    const scope = { kind: "brand", brandId: brand.id };
    await saveCanon({ text: "One clever object.", reason: "His picks." });
    await saveCanon({ text: "Show the cap.", reason: "He said so.", scope });
    await saveCanon({ text: "Show the pump.", reason: "He changed his mind.", scope });
    await saveCanon({ text: "One light source.", reason: "Seen in checks.", scope: { kind: "craft" } });

    const taste = await json(await get("/api/taste"));
    expect(taste.canon.text).toBe("One clever object.");
    expect(taste.canons.map((entry: { name: string; canon: { text: string } }) => [entry.name, entry.canon.text])).toEqual([
      ["Creative craft", "One light source."],
      ["Performance", ""],
      ["WonGi", "Show the pump."],
    ]);
    expect((await json(await get(`/api/taste/canon/1?kind=brand&brandId=${brand.id}`))).text).toBe("Show the cap.");
    expect((await json(await get("/api/taste/canon/1?kind=craft"))).text).toBe("One light source.");
    expect((await get("/api/taste/canon/1?kind=performance")).status).toBe(404);

    const back = await post("/api/taste/canon/restore", { version: 1, reason: "The cap after all.", scope });
    expect(await json(back)).toMatchObject({ version: 3, text: "Show the cap." });
    const page = await json(await get(`/api/brands/${brand.id}`));
    expect(page.canon).toMatchObject({ version: 3, text: "Show the cap." });
    expect(page.canonVersions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    // The owner's taste did not move.
    expect((await json(await get("/api/taste"))).canon.version).toBe(1);
  });

  it("refuses a scope that names no brand the studio has, and a brand on another scope", async () => {
    for (const scope of [{ kind: "brand" }, { kind: "brand", brandId: "nope" }, { kind: "craft", brandId: "b1" }, { kind: "other" }]) {
      expect((await saveCanon({ text: "x", reason: "y", scope })).status, JSON.stringify(scope)).toBe(400);
      expect((await post("/api/taste/canon/restore", { version: 1, reason: "y", scope })).status, JSON.stringify(scope)).toBe(400);
    }
    expect((await get("/api/taste/canon/1?kind=brand&brandId=nope")).status).toBe(404);
    expect((await get("/api/taste/canon/1?kind=craft&brandId=b1")).status).toBe(404);
    expect((await post("/api/taste/canon/restore", { version: 4, reason: "y" })).status).toBe(400);
  });

  it("shows a proposal with the notes it rests on, and changes the canon only on the owner's yes", async () => {
    const scope = { kind: "craft" };
    const ids = [];
    for (const what of ["He passed on the spoon.", "He passed on the napkin."]) ids.push((await callTool(studio, "learn", seen(scope, what))).value.id);
    const first = (await callTool(studio, "canon_propose", { ...rules, scope, text: "No prop beside the food.", reason: "He passed on every prop.", recordIds: ids })).value;
    const second = (await callTool(studio, "canon_propose", { ...rules, scope, text: "One prop at most.", reason: "A softer rule.", recordIds: ids })).value;

    let taste = await json(await get("/api/taste"));
    expect(taste.learning.map((entry: { scopeName: string }) => entry.scopeName)).toEqual(["Creative craft", "Creative craft"]);
    expect(taste.proposals).toHaveLength(2);
    expect(taste.proposals[0]).toMatchObject({ status: "proposed", scopeName: "Creative craft", current: { version: 0 } });
    expect(taste.canons[0].canon.version).toBe(0);

    const member = await sessionCookie(studio, "member");
    expect((await post(`/api/taste/proposals/${first.id}`, { approve: true, ownerSaid: "yes" }, member)).status).toBe(403);
    expect((await post(`/api/taste/proposals/${first.id}`, { approve: true, ownerSaid: "yes" }, cookie, "https://evil.example")).status).toBe(403);
    expect((await post(`/api/taste/proposals/${first.id}`, { approve: true, ownerSaid: " " })).status).toBe(400);
    expect((await post("/api/taste/proposals/nope", { approve: true, ownerSaid: "yes" })).status).toBe(400);
    expect((await json(await get("/api/taste"))).canons[0].canon.version).toBe(0);

    const yes = await post(`/api/taste/proposals/${first.id}`, { approve: true, ownerSaid: "yes, no props" });
    expect(await json(yes)).toMatchObject({ proposal: { status: "approved", ownerSaid: "yes, no props", version: 1 } });
    // The other was written against the canon before this yes.
    const stale = await post(`/api/taste/proposals/${second.id}`, { approve: true, ownerSaid: "this too" });
    expect(stale.status).toBe(400);
    expect((await json(stale)).error).toBe("refused");
    expect((await post(`/api/taste/proposals/${second.id}`, { approve: false, ownerSaid: "no, the first is enough" })).status).toBe(200);

    taste = await json(await get("/api/taste"));
    expect(taste.canons[0].canon).toMatchObject({ version: 1, text: "No prop beside the food.", savedBy: "owner@example.com" });
    expect(taste.proposals.map((proposal: { status: string }) => proposal.status).sort()).toEqual(["approved", "declined"]);
  });

  it("keeps the owner's choice for a brand in his words, and shows it on that brand only", async () => {
    const { brand } = await savedProduct(studio);
    const other = await studio.services.brands.saveBrand({ name: "Oatly", url: "https://oatly.example/", logo: null, palette: [], fonts: [], savedBy: "owner@example.com" });
    const notes = `/api/brands/${brand.id}/notes`;

    expect((await post(notes, { note: "Show the pouch." }, "")).status).toBe(401);
    expect((await post(notes, { note: "Show the pouch." }, await sessionCookie(studio, "member"))).status).toBe(403);
    expect((await post(notes, { note: "Show the pouch." }, cookie, "https://evil.example")).status).toBe(403);
    expect((await post(notes, { note: " " })).status).toBe(400);
    expect((await post(notes, { note: "x".repeat(501) })).status).toBe(400);
    expect((await post("/api/brands/nope/notes", { note: "Show the pouch." })).status).toBe(404);

    const saved = await post(notes, { note: "Show the pouch, not the bowl." });
    expect(await json(saved)).toMatchObject({ brandId: brand.id, note: "Show the pouch, not the bowl.", ownerSaid: "Show the pouch, not the bowl.", savedBy: "owner@example.com" });
    expect((await json(await get(`/api/brands/${brand.id}`))).notes).toEqual([expect.objectContaining({ note: "Show the pouch, not the bowl." })]);
    expect((await json(await get(`/api/brands/${other.id}`))).notes).toEqual([]);
    // A note is no product fact.
    expect((await json(await get(`/api/brands/${brand.id}`))).products[0].facts).toEqual([]);
  });
});
