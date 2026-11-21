import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { directionOf, draftPlan, PICKED, rules, v3AtConcepts, v3AtWorded } from "../helpers/v3.js";

let studio: Studio;
let batchId: string;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

const save = (concepts: object[] = PICKED.map((ideaId) => directionOf(ideaId))) => callTool(studio, "direction_save", { ...rules, batchId, concepts });
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;

describe("the direction of a concept ad", () => {
  it("is not saved before the owner's yes to the words", async () => {
    ({ batchId } = await v3AtConcepts(studio));
    expect(await save()).toMatchObject({ ok: false, error: expect.stringMatching(/direction_save cannot run yet/) });
  });

  describe("after the words are approved", () => {
    beforeEach(async () => {
      ({ batchId } = await v3AtWorded(studio));
    });

    it("saves one direction for each picked concept, numbers its drafts and moves the batch on", async () => {
      const saved = await save();
      expect(saved.value).toMatchObject({ state: "directed", direction: { version: 1, by: "owner@example.com" }, nextStep: expect.stringMatching(/draft/) });
      expect(saved.value.direction.concepts.map((concept: { ideaId: string }) => concept.ideaId)).toEqual(PICKED);
      expect(saved.value.direction.concepts[0].drafts.map((draft: { number: number }) => draft.number)).toEqual([1, 2, 3]);
      expect((await callTool(studio, "direction_get", { batchId })).value.direction).toMatchObject({ version: 1 });
    });

    it("asks for every picked concept once, and no other", async () => {
      expect(await save([directionOf("idea-2"), directionOf("idea-4")])).toMatchObject({ ok: false, error: expect.stringMatching(/Missing: idea-5/) });
      expect(await save([directionOf("idea-2"), directionOf("idea-2"), directionOf("idea-4")])).toMatchObject({ ok: false, error: expect.stringMatching(/each once/) });
      expect(await save([directionOf("idea-2"), directionOf("idea-4"), directionOf("idea-1")])).toMatchObject({ ok: false, error: expect.stringMatching(/idea-1 is not a concept the owner picked/) });
      expect(await state()).toBe("worded");
    });

    it("takes exactly three drafts for a concept", async () => {
      const two = await save([directionOf("idea-2", { drafts: [draftPlan(1), draftPlan(2)] }), directionOf("idea-4"), directionOf("idea-5")]);
      expect(two.ok).toBe(false);
      const four = await save([directionOf("idea-2", { drafts: [draftPlan(1), draftPlan(2), draftPlan(3), draftPlan(4)] }), directionOf("idea-4"), directionOf("idea-5")]);
      expect(four.ok).toBe(false);
      expect(await state()).toBe("worded");
    });

    it("refuses drafts that are one picture three times", async () => {
      // Drafts 1 and 2 differ in light and environment only.
      const same = { composition: "centre", camera: "above", scale: "a third" };
      const near = await save([
        directionOf("idea-2", { drafts: [draftPlan(1, same), draftPlan(2, { ...same, light: "soft", environment: "red seamless" }), draftPlan(3)] }),
        directionOf("idea-4"),
        directionOf("idea-5"),
      ]);
      expect(near).toMatchObject({ ok: false, error: expect.stringMatching(/idea-2: drafts 1 and 2 differ on 2 of 8 axes \(light, environment\)/) });
      // Three axes apart, and none of them is composition, camera or scale.
      const lit = await save([
        directionOf("idea-2", { drafts: [draftPlan(1, same), draftPlan(2, { ...same, light: "soft", environment: "red seamless", staging: "two pouches" }), draftPlan(3)] }),
        directionOf("idea-4"),
        directionOf("idea-5"),
      ]);
      expect(lit).toMatchObject({ ok: false, error: expect.stringMatching(/idea-2: drafts 1 and 2 differ on light, environment, staging, and on none of composition, camera, scale/) });
      // The same words in other letter case and spacing are the same answer.
      const cased = await save([
        directionOf("idea-2", { drafts: [draftPlan(1, same), draftPlan(2, { composition: " Centre ", camera: "ABOVE", scale: "a  third" }), draftPlan(3)] }),
        directionOf("idea-4"),
        directionOf("idea-5"),
      ]);
      expect(cased).toMatchObject({ ok: false, error: expect.stringMatching(/differ on 0 of 8 axes \(none\)/) });
      expect(await state()).toBe("worded");
    });

    it("asks for the reason of a high risk", async () => {
      const bare = await save([directionOf("idea-2", { risk: "high" }), directionOf("idea-4"), directionOf("idea-5")]);
      expect(bare).toMatchObject({ ok: false, error: expect.stringMatching(/idea-2: a high risk needs its reason/) });
      const reasoned = await save([directionOf("idea-2", { risk: "high", riskReason: "The pouch is torn open by a hand: the tear is the idea. Lower risk: the pouch already open." }), directionOf("idea-4"), directionOf("idea-5")]);
      expect(reasoned.value.direction.concepts[0]).toMatchObject({ risk: "high", riskReason: expect.stringMatching(/tear is the idea/) });
    });

    it("keeps every version", async () => {
      await save();
      const again = await save(PICKED.map((ideaId) => directionOf(ideaId, { lockup: "top_band_left" })));
      expect(again.value).toMatchObject({ state: "directed", direction: { version: 2 } });
      expect(await studio.services.directions.version(batchId, 1)).toMatchObject({ concepts: [{ lockup: "flush_left" }, {}, {}] });
      expect(await studio.services.directions.get(batchId)).toMatchObject({ version: 2, concepts: [{ lockup: "top_band_left" }, {}, {}] });
    });

    it("is for a batch of concept ads only", async () => {
      const got = (await callTool(studio, "batch_get", { batchId })).value;
      const v2 = await callTool(studio, "batch_create", { kind: "v2", brandId: got.brand.id, productId: got.product.id });
      expect(await callTool(studio, "direction_save", { ...rules, batchId: v2.value.batch.id, concepts: [directionOf("idea-1")] })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a batch of concept ads/) });
      expect(await callTool(studio, "direction_get", { batchId: v2.value.batch.id })).toMatchObject({ ok: false });
    });
  });
});
