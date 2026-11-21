import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { missingStep, requireMove, stepAfter } from "../../src/batch/state.js";
import { batchAtTruth, idea, savedProduct, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

describe("batch state", () => {
  it("refuses a drafting step while the batch is at ideas, and names the missing step", () => {
    expect(() => requireMove({ kind: "v1", state: "ideas" }, "drafting", "render_submit")).toThrow(/render_submit cannot run yet: the batch is at "ideas"\. The step that is missing: the blind pick/);
    expect(missingStep("v1", "ideas", "judged")).toBeUndefined();
    expect(missingStep("v1", "priced", "drafting")).toBeUndefined();
    expect(missingStep("v1", "intake", "ideas")).toMatch(/truth_save/);
    expect(missingStep("v1", "spec_only", "drafting")).toMatch(/does not render/);
  });

  it("names what comes next from each state", () => {
    expect(stepAfter({ kind: "v1", state: "intake" })).toMatch(/truth_save/);
    expect(stepAfter({ kind: "v1", state: "truth" })).toMatch(/ideas_save/);
    expect(stepAfter({ kind: "v1", state: "done" })).toMatch(/at its end/);
  });

  it("refuses a batch without a saved brand and product", async () => {
    const none = await callTool(studio, "batch_create", { kind: "v1", brandId: "nope", productId: "nope" });
    expect(none).toEqual({ ok: false, error: expect.stringMatching(/no brand/) });
    const { brand } = await savedProduct(studio);
    const noProduct = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: "nope" });
    expect(noProduct).toEqual({ ok: false, error: expect.stringMatching(/no product/) });
    expect((await callTool(studio, "batch_list")).value.batches).toEqual([]);
  });

  it("refuses a product of another brand", async () => {
    const { product } = await savedProduct(studio);
    const other = await studio.services.brands.saveBrand({ name: "Other", url: "https://other.example/", logo: null, palette: [], fonts: [], savedBy: "o" });
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: other.id, productId: product.id });
    expect(made).toEqual({ ok: false, error: expect.stringMatching(/belongs to another brand/) });
  });

  it("returns state truth and the saved sheet for a batch that stopped after the truth sheet", async () => {
    const { brand, product } = await savedProduct(studio);
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id });
    expect(made.value).toMatchObject({ batch: { state: "intake" }, nextStep: expect.stringMatching(/truth_save/) });
    const batchId = made.value.batch.id;
    await callTool(studio, "truth_save", { batchId, ...sheet });

    // A new session knows only the batch id.
    const resumed = await callTool(studio, "batch_get", { batchId });
    expect(resumed.value).toMatchObject({
      batch: { id: batchId, state: "truth" },
      truthSheet: { shape: sheet.shape, packaging: sheet.packaging },
      brand: { name: "WonGi" },
      product: { name: "Seaweed crisps" },
      tasteNotRead: ["canon_get", "taste_log", "swipe_search"],
      nextStep: expect.stringMatching(/canon_get, taste_log, swipe_search.*ideas_save/),
    });
  });

  it("refuses ideas before the truth sheet, and names it", async () => {
    const { brand, product } = await savedProduct(studio);
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id });
    const saved = await callTool(studio, "ideas_save", { rulesVersion: RULES_VERSION, batchId: made.value.batch.id, ideas: [idea(1), idea(2), idea(3)] });
    expect(saved).toEqual({ ok: false, error: expect.stringMatching(/batch is at "intake".*truth_save/) });
  });

  it("ends a 9:16 story batch in spec_only and names rendering as the step it cannot do", async () => {
    const { batchId } = await batchAtTruth(studio, { format: "other", formatNote: "9:16 story" });
    const ideas = await callTool(studio, "ideas_save", { rulesVersion: RULES_VERSION, batchId, ideas: [idea(1), idea(2), idea(3)] });
    expect(ideas.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/spec_save/), note: expect.stringMatching(/cannot do is rendering/) });
    const spec = await callTool(studio, "spec_save", { rulesVersion: RULES_VERSION, batchId, spec: "Panel 1: the pack on the rock." });
    expect(spec.value).toEqual({ state: "spec_only", note: expect.stringMatching(/cannot do is rendering/) });
    const got = await callTool(studio, "batch_get", { batchId });
    expect(got.value.batch).toMatchObject({ state: "spec_only", spec: "Panel 1: the pack on the rock.", formatNote: "9:16 story" });
    expect(got.value.nextStep).toMatch(/at its end/);
  });

  it("refuses a text spec for a static 4:5 batch, and a format with no words for it", async () => {
    const { batchId, brand, product } = await batchAtTruth(studio);
    await callTool(studio, "ideas_save", { rulesVersion: RULES_VERSION, batchId, ideas: [idea(1), idea(2), idea(3)] });
    expect(await callTool(studio, "spec_save", { rulesVersion: RULES_VERSION, batchId, spec: "x" })).toEqual({ ok: false, error: expect.stringMatching(/the studio renders it/) });
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id, format: "other" });
    expect(made).toEqual({ ok: false, error: expect.stringMatching(/formatNote/) });
  });
});
