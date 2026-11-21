import { beforeEach, describe, expect, it } from "vitest";
import { PAGE, savedProduct, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { extractReply } from "../helpers/parallel.js";

let studio: Studio;
let batchId: string;
let productId: string;

beforeEach(async () => {
  studio = await createStudio({ parallel: extractReply({ [PAGE]: "Seaweed crisps. Net weight: 40 g." }) });
  await approvedClient(studio);
  const { brand, product } = await savedProduct(studio);
  productId = product.id;
  batchId = (await callTool(studio, "batch_create", { brandId: brand.id, productId })).value.batch.id;
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
});
