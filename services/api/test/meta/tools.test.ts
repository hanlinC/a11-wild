import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { pickedBatch } from "../helpers/picked.js";

const rules = { rulesVersion: RULES_VERSION };
const variant = (extra: object = {}) => ({
  primary: "The skin is the best part. We fry it until it curls, then coat every piece in salted egg. Order yours today.",
  headline: "The skin, done right",
  description: "Order the salted egg fish skin",
  cta: "Order Now",
  ...extra,
});
const second = variant({ primary: "Salted egg, on every piece. That is the whole idea. Order yours today." });

let studio: Studio;
let batchId: string;

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  batchId = (await pickedBatch(studio)).batch.id;
});

const save = (ads: object[]) => callTool(studio, "meta_save", { ...rules, batchId, ads });

describe("meta_save", () => {
  it("saves two variants for an ad as version 1, and the same text again is the same version", async () => {
    const first = await save([{ ideaId: "idea-1", variants: [variant(), second] }]);
    expect(first.value.saved).toMatchObject([{ ideaId: "idea-1", version: 1, by: "owner@example.com" }]);
    expect(first.value.saved[0].approved).toBeUndefined();
    expect((await save([{ ideaId: "idea-1", variants: [variant(), second] }])).value.saved[0].version).toBe(1);
    expect((await save([{ ideaId: "idea-1", variants: [variant({ headline: "Skin first" }), second] }])).value.saved[0].version).toBe(2);
  });

  it("saves nothing of a call when one ad's text fails a check", async () => {
    const sent = await save([
      { ideaId: "idea-2", variants: [variant(), second] },
      { ideaId: "idea-3", variants: [variant({ description: "Loved by 20,000 buyers" }), second] },
    ]);
    expect(sent).toMatchObject({ ok: false, error: expect.stringMatching(/idea-3 is not saved: variant A: no saved fact holds the number 20000/) });
    expect((await callTool(studio, "meta_get", { batchId })).value.ads).toEqual([]);
  });

  it("refuses an offer on the top-of-funnel ad and takes it on the bottom one", async () => {
    const offer = variant({ description: "Free delivery today" });
    expect((await save([{ ideaId: "idea-1", variants: [offer, second] }])).ok).toBe(false);
    expect((await save([{ ideaId: "idea-3", variants: [offer, second] }])).ok).toBe(true);
  });

  it("refuses text for an idea the owner passed on, an unknown idea, a button off the list and a batch with no picks yet", async () => {
    await studio.services.picks.save(batchId, { ideaId: "idea-2", imageId: null, ownerSaid: "none of these", by: "owner@example.com" });
    expect(await save([{ ideaId: "idea-2", variants: [variant(), second] }])).toMatchObject({ ok: false, error: expect.stringMatching(/picked no draft of idea-2/) });
    expect(await save([{ ideaId: "idea-9", variants: [variant(), second] }])).toMatchObject({ ok: false, error: expect.stringMatching(/no idea idea-9/) });
    expect((await save([{ ideaId: "idea-1", variants: [variant({ cta: "Buy It" }), second] }])).ok).toBe(false);
    const batch = await studio.services.batches.get(batchId);
    await studio.table.put({ pk: "BATCH", sk: batchId, ...batch, state: "waiting_pick" });
    expect(await save([{ ideaId: "idea-1", variants: [variant(), second] }])).toMatchObject({ ok: false, error: expect.stringMatching(/after the owner picked/) });
  });

  it("asks no opening line of a v1 picture, which has no words", async () => {
    const wild = (await pickedBatch(studio, "v1")).batch.id;
    const sent = await callTool(studio, "meta_save", { ...rules, batchId: wild, ads: [{ ideaId: "idea-1", variants: [variant({ primary: "Some snacks you share. This one you hide. Order yours today." }), second] }] });
    expect(sent.ok).toBe(true);
  });
});

describe("meta_approve", () => {
  it("is the owner's alone, and names a version that exists", async () => {
    await save([{ ideaId: "idea-1", variants: [variant(), second] }]);
    const yes = { ...rules, batchId, ads: [{ ideaId: "idea-1", version: 1, ownerSaid: "yes, run it" }] };
    expect(await callTool(studio, "meta_approve", yes, { sub: "sub-member" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only the owner/) });
    expect(await callTool(studio, "meta_approve", { ...yes, ads: [{ ...yes.ads[0], version: 2 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/no version 2/) });
    expect((await callTool(studio, "meta_approve", yes)).value.approved).toMatchObject([{ ideaId: "idea-1", version: 1, approved: { ownerSaid: "yes, run it", by: "owner@example.com" } }]);
  });

  it("keeps the approved version as the pack's text when newer text is saved after it", async () => {
    await save([{ ideaId: "idea-1", variants: [variant(), second] }]);
    await callTool(studio, "meta_approve", { ...rules, batchId, ads: [{ ideaId: "idea-1", version: 1, ownerSaid: "yes" }] });
    await save([{ ideaId: "idea-1", variants: [variant({ headline: "Skin first" }), second] }]);
    const { ads } = (await callTool(studio, "meta_get", { batchId })).value;
    expect(ads).toMatchObject([{ ideaId: "idea-1", approvedVersion: 1, versions: [{ version: 1 }, { version: 2 }] }]);
    expect((await studio.services.meta.approved(batchId, "idea-1"))?.version).toBe(1);
  });
  it("gives two saves at one moment a version each: neither text is lost", async () => {
    const store = studio.services.meta;
    const one = [variant({ headline: "Skin first" }), second];
    const two = [variant({ headline: "Curled and crisp" }), second];
    const saved = await Promise.all([one, two].map((variants) => store.save(batchId, { ideaId: "idea-1", variants: variants as never, by: "owner@example.com" })));
    expect(saved.map((text) => text.version).sort()).toEqual([1, 2]);
    expect((await store.versions(batchId, "idea-1")).map((text) => text.variants[0].headline).sort()).toEqual(["Curled and crisp", "Skin first"]);
  });
});
