import { beforeEach, describe, expect, it } from "vitest";
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
const saveCanon = (body: unknown, as = cookie, origin: string | undefined = ORIGIN) =>
  studio.app.request("/api/taste/canon", {
    method: "POST",
    headers: { cookie: as, "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

describe("studio routes", () => {
  it("answers 401 without a session on every route", async () => {
    for (const path of ["/api/brands", "/api/brands/x", "/api/batches", "/api/spend", "/api/taste", "/api/taste/canon/1", "/api/calibration", "/api/batches/x/done"]) {
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
    expect((await json(await get("/api/batches"))).batches).toEqual([
      { batch: expect.objectContaining({ id: batchId, state: "truth" }), brand: { id: brand.id, name: "WonGi" }, product: { id: product.id, name: "Seaweed crisps" } },
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
});
