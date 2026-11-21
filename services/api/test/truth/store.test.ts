import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { idea, PAGE, readTaste, savedProduct, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { extractReply } from "../helpers/parallel.js";

let studio: Studio;
let batchId: string;
let productId: string;
let brandId: string;

beforeEach(async () => {
  studio = await createStudio({ parallel: extractReply({ [PAGE]: "Seaweed crisps. Net weight: 40 g." }) });
  await approvedClient(studio);
  const { brand, product } = await savedProduct(studio);
  productId = product.id;
  brandId = brand.id;
  batchId = (await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId })).value.batch.id;
});

describe("truth sheet", () => {
  it("stores and returns a height with no source fact as unverified", async () => {
    const saved = await callTool(studio, "truth_save", { batchId, ...sheet, measures: [{ name: "pack height", value: 180, unit: "mm" }] });
    expect(saved.value).toMatchObject({ state: "truth", unverified: ["pack height"] });
    const got = await callTool(studio, "batch_get", { batchId });
    expect(got.value.truthSheet.measures).toEqual([{ name: "pack height", value: 180, unit: "mm", status: "unverified" }]);
  });

  it("carries the quote and the page of the fact that proves a number", async () => {
    const facts = await callTool(studio, "facts_save", { productId, facts: [{ claim: "A pack holds 40 g", quote: "Net weight: 40 g.", url: PAGE }] });
    const factId = facts.value.saved[0].id;
    const saved = await callTool(studio, "truth_save", {
      batchId,
      ...sheet,
      measures: [
        { name: "net weight", value: 40, unit: "g", factId },
        { name: "pack height", value: 180, unit: "mm" },
      ],
    });
    expect(saved.value.truthSheet.measures[0]).toEqual({ name: "net weight", value: 40, unit: "g", status: "sourced", source: { factId, quote: "Net weight: 40 g.", url: PAGE } });
    expect(saved.value.unverified).toEqual(["pack height"]);
  });

  it("refuses a number that names a fact the product does not have", async () => {
    const saved = await callTool(studio, "truth_save", { batchId, ...sheet, measures: [{ name: "net weight", value: 40, unit: "g", factId: "made-up" }] });
    expect(saved).toEqual({ ok: false, error: expect.stringMatching(/not a saved fact of this product/) });
    expect((await callTool(studio, "batch_get", { batchId })).value).toMatchObject({ batch: { state: "intake" }, truthSheet: null });
  });

  it("takes only the product's own food photos", async () => {
    const stray = await callTool(studio, "truth_save", { batchId, ...sheet, food: { photoKeys: ["products/other/x.jpg"], proportions: "Whole crisps." } });
    expect(stray).toEqual({ ok: false, error: expect.stringMatching(/not a food photo of this product/) });
    const own = await callTool(studio, "truth_save", { batchId, ...sheet, food: { photoKeys: ["products/p/food.jpg"], proportions: "Whole crisps, never broken." } });
    expect(own.value.truthSheet.food).toEqual({ photoKeys: ["products/p/food.jpg"], proportions: "Whole crisps, never broken." });
  });

  it("keeps every version, and a batch keeps the one it saved when a later batch changes the sheet", async () => {
    const first = await callTool(studio, "truth_save", { batchId, ...sheet, measures: [{ name: "pack height", value: 180, unit: "mm" }] });
    expect(first.value.truthSheet.version).toBe(1);
    await readTaste(studio, batchId);
    await callTool(studio, "ideas_save", { rulesVersion: RULES_VERSION, batchId, ideas: [idea(1), idea(2), idea(3)] });

    const later = (await callTool(studio, "batch_create", { kind: "v1", brandId, productId })).value.batch.id;
    // A new batch sees the product's sheet before it saves one, and a save that changes nothing keeps the version.
    expect((await callTool(studio, "batch_get", { batchId: later })).value.truthSheet.version).toBe(1);
    const same = await callTool(studio, "truth_save", { batchId: later, ...sheet, measures: [{ name: "pack height", value: 180, unit: "mm" }] });
    expect(same.value.truthSheet.version).toBe(1);
    const changed = await callTool(studio, "truth_save", { batchId: later, ...sheet, measures: [{ name: "pack height", value: 185, unit: "mm" }] });
    expect(changed.value.truthSheet.version).toBe(2);

    const resumed = (await callTool(studio, "batch_get", { batchId })).value;
    expect(resumed.batch.truthVersion).toBe(1);
    expect(resumed.truthSheet).toMatchObject({ version: 1, measures: [{ value: 180 }] });
    expect(resumed.truthNote).toMatch(/keeps version 1.*now at version 2/);
    const newest = (await callTool(studio, "batch_get", { batchId: later })).value;
    expect(newest.truthSheet).toMatchObject({ version: 2, measures: [{ value: 185 }] });
    expect(newest.truthNote).toBeUndefined();

    const all = (await callTool(studio, "truth_get", { productId })).value;
    expect(all.truthSheet.version).toBe(2);
    expect(all.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await callTool(studio, "truth_get", { productId, version: 1 })).value.truthSheet.measures[0].value).toBe(180);
    expect(await callTool(studio, "truth_get", { productId, version: 3 })).toEqual({ ok: false, error: expect.stringMatching(/no version 3/) });
  });
});
