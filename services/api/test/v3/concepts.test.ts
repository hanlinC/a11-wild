import { beforeEach, describe, expect, it } from "vitest";
import { idea } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { brief, concept, concepts, rules, v3AtConcepts, v3AtTruth } from "../helpers/v3.js";

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

const state = async (batchId: string) => (await callTool(studio, "batch_get", { batchId })).value.batch.state as string;

describe("the brief of a concept ad", () => {
  it("is asked for before any concept, and gives each insight an id", async () => {
    const { batchId } = await v3AtTruth(studio);
    expect((await callTool(studio, "batch_get", { batchId })).value.nextStep).toMatch(/brief_save/);
    const early = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: concepts() });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/brief_save/) });
    const old = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
    expect(old).toMatchObject({ ok: false, error: expect.stringMatching(/brief_save.*concepts_save/) });

    const saved = await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    expect(saved.value).toMatchObject({ state: "briefed", brief: { version: 1, by: "owner@example.com" }, nextStep: expect.stringMatching(/concepts_save/) });
    expect(saved.value.brief.insights.map((insight: { id: string }) => insight.id)).toEqual(["insight-1", "insight-2", "insight-3", "insight-4"]);
    expect((await callTool(studio, "brief_get", { batchId })).value.brief.unknowns).toEqual(["How many packs a buyer takes in one order."]);
    expect((await callTool(studio, "batch_get", { batchId })).value.brief.insights).toHaveLength(4);
  });

  it("refuses evidence with no page or no buyer's words", async () => {
    const { batchId } = await v3AtTruth(studio);
    const bare = brief({ insights: [{ text: "They hide the last pack.", basis: "evidence", sourceUrl: "https://forum.example/thread/2" }, ...brief().insights.slice(1)] });
    expect(await callTool(studio, "brief_save", { ...rules, batchId, ...bare })).toMatchObject({ ok: false, error: expect.stringMatching(/Insight 1 is given as evidence and has no the buyer's exact words/) });
    const plain = brief({ insights: [{ ...brief().insights[0], sourceUrl: "http://forum.example/thread/1" }, ...brief().insights.slice(1)] });
    expect(await callTool(studio, "brief_save", { ...rules, batchId, ...plain })).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    expect(await state(batchId)).toBe("truth");
    expect((await callTool(studio, "brief_get", { batchId })).value.brief).toBeNull();
  });

  it("stops a batch with fewer than three insights that are no guess, until a fuller brief is saved", async () => {
    const { batchId } = await v3AtTruth(studio);
    const thin = brief({ insights: [brief().insights[0], brief().insights[2], brief().insights[3], { text: "Students share one pack in class.", basis: "hypothesis" }] });
    const saved = await callTool(studio, "brief_save", { ...rules, batchId, ...thin });
    expect(saved.value).toMatchObject({ state: "briefed", stop: expect.stringMatching(/has 2 insights that are no hypothesis.*never invent/) });
    expect(saved.value.nextStep).toBeUndefined();
    const refused = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: concepts() });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/Tell the owner/) });

    const fuller = await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    expect(fuller.value).toMatchObject({ brief: { version: 2 }, nextStep: expect.stringMatching(/concepts_save/) });
    expect((await callTool(studio, "concepts_save", { ...rules, batchId, concepts: concepts() })).ok).toBe(true);
  });

  it("is for a concept ad only, and is closed once concepts are saved", async () => {
    const { batchId } = await v3AtConcepts(studio);
    expect(await callTool(studio, "brief_save", { ...rules, batchId, ...brief() })).toMatchObject({ ok: false, error: expect.stringMatching(/its step is over/) });
    const brand = (await callTool(studio, "batch_get", { batchId })).value;
    const v2 = await callTool(studio, "batch_create", { kind: "v2", brandId: brand.brand.id, productId: brand.product.id });
    expect(await callTool(studio, "brief_save", { ...rules, batchId: v2.value.batch.id, ...brief() })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a batch of concept ads/) });
    expect(await callTool(studio, "concepts_save", { ...rules, batchId: v2.value.batch.id, concepts: concepts() })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a batch of concept ads/) });
  });
});

describe("the concepts of a concept ad", () => {
  const refused = async (set: object[], pattern: RegExp) => {
    const { batchId } = await v3AtTruth(studio);
    await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    expect(await callTool(studio, "concepts_save", { ...rules, batchId, concepts: set })).toMatchObject({ ok: false, error: expect.stringMatching(pattern) });
    expect(await state(batchId)).toBe("briefed");
    expect((await callTool(studio, "batch_get", { batchId })).value.burst).toEqual([]);
  };

  it("saves the whole set with ids, and keeps no concept as an idea of the batch yet", async () => {
    const { batchId } = await v3AtConcepts(studio);
    const got = (await callTool(studio, "batch_get", { batchId })).value;
    expect(got.batch.state).toBe("ideas");
    expect(got.ideas).toEqual([]);
    expect(got.burst).toHaveLength(6);
    expect(got.burst[0]).toMatchObject({ id: "idea-1", device: "The empty pack as a full stop", concept: { territory: "Territory 2", insightId: "insight-2", sublineBasis: { kind: "second_beat" }, pictureAlone: "Someone finished the pack." } });
    expect(got.nextStep).toMatch(/concept_review_save/);
  });

  it("refuses a set of 5", () => refused(concepts(5), /A set holds 6 to 15 concepts\. This one has 5/));
  it("refuses 2 territories", () => refused(concepts(6, () => ({}), 2), /A set has 3 to 5 territories\. This one has 2/));
  it("refuses 6 territories", () =>
    refused(
      concepts(6, (n) => ({ territory: `T${n}`, insightId: `insight-${((n - 1) % 4) + 1}` })),
      /A set has 3 to 5 territories\. This one has 6/,
    ));
  it("refuses two territories on one insight", () => refused(concepts(6, (n) => (n === 1 ? { territory: "Another name" } : {})), /stand on the same insight insight-2\. They are one territory/));
  it("refuses a territory on two insights", () => refused(concepts(6, (n) => (n === 1 ? { insightId: "insight-4" } : {})), /The territory "territory 2" stands on 2 insights/));
  it("refuses an insight the brief does not have", () => refused(concepts(6, (n) => (n === 1 ? { insightId: "insight-9" } : {})), /the brief has no such insight/));
  it("refuses a number no fact proves", () => refused(concepts(6, (n) => (n === 2 ? { subline: "40% less salt." } : {})), /40/));
  it("refuses an offer on a top-of-funnel concept", () => refused(concepts(6, (n) => (n === 3 ? { stage: "tof", headline: "Now S$30 for six" } : {})), /top-of-funnel/));
  it("keeps the set whole when two calls add concepts at the same moment", async () => {
    const { batchId } = await v3AtTruth(studio);
    await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    await callTool(studio, "concepts_save", { ...rules, batchId, concepts: concepts() });
    const { batches } = studio.services;
    const before = await batches.burst(batchId);
    // Both calls read the same six concepts, and each means to write its own seventh.
    const seventh = (title: string) => batches.extendBurst(batchId, [...before, { ...before[0]!, id: "idea-7", title }], "owner@example.com", before.length);
    expect(await Promise.all([seventh("First"), seventh("Second")])).toEqual([true, false]);
    expect((await batches.burst(batchId)).map((idea) => idea.title).slice(-1)).toEqual(["First"]);
    // A call that took a round and died before it saved does not lock the set: after a minute the next call takes the round over.
    const now = await batches.burst(batchId);
    await studio.table.put({ pk: `BATCH#${batchId}`, sk: `BURST#AFTER#${now.length}`, by: "owner@example.com", at: studio.clock.now.toISOString() });
    const blocked = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(8, { territory: "Desk at four", insightId: "insight-4" })] });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/another call added concepts/) });
    studio.clock.now = new Date(studio.clock.now.getTime() + 61_000);
    // The call that lost reads the set again and adds to it.
    const more = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(8, { territory: "Desk at four", insightId: "insight-4" })] });
    expect(more.value.concepts).toHaveLength(8);
  });

  it("refuses a shown item with no real photo", () => refused(concepts(6, (n) => (n === 4 ? { shows: ["pack-1", "prop-1"] } : {})), /shows prop-1, and this product has no such photo/));
  it("refuses a subline given as a fact with no fact", () => refused(concepts(6, (n) => (n === 5 ? { sublineBasis: { kind: "fact" } } : {})), /its subline is a fact/));
  it("refuses more than five elements", () => refused(concepts(6, (n) => (n === 6 ? { elements: ["a", "b", "c", "d", "e", "f"] } : {})), /has 6 elements/));

  it("refuses concepts before the owner's taste and the reference ads were read", async () => {
    const { brand, product } = await v3AtTruth(studio);
    const made = await callTool(studio, "batch_create", { kind: "v3", brandId: brand.id, productId: product.id });
    const batchId = made.value.batch.id as string;
    await callTool(studio, "truth_save", { batchId, shape: "A flat pouch.", packaging: "Black pouch.", measures: [] });
    await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    expect(await callTool(studio, "concepts_save", { ...rules, batchId, concepts: concepts() })).toMatchObject({ ok: false, error: expect.stringMatching(/Not read yet: .*references_get/) });
  });

  it("names the concepts that stand on a guess", async () => {
    const { batchId } = await v3AtTruth(studio);
    await callTool(studio, "brief_save", { ...rules, batchId, ...brief() });
    const set = [...concepts(), concept(7, { territory: "Desk at four", insightId: "insight-4" })];
    const saved = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: set });
    expect(saved.value.note).toMatch(/stand on a hypothesis: idea-7/);
  });

  it("adds concepts in a later call and deletes none", async () => {
    const { batchId } = await v3AtConcepts(studio);
    const more = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(7, { title: "New one", territory: "Desk at four", insightId: "insight-4" })] });
    expect(more.ok).toBe(true);
    const burst = (await callTool(studio, "batch_get", { batchId })).value.burst as { id: string; title: string }[];
    expect(burst.map((entry) => entry.id)).toEqual(["idea-1", "idea-2", "idea-3", "idea-4", "idea-5", "idea-6", "idea-7"]);
    expect(burst[0]?.title).toBe("Concept 1");
    expect(burst[6]?.title).toBe("New one");
    // A fault in the added concept saves nothing of the call.
    const bad = await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(8, { insightId: "insight-9" })] });
    expect(bad.ok).toBe(false);
    expect((await callTool(studio, "batch_get", { batchId })).value.burst).toHaveLength(7);
  });

  it("makes no batch of concept ads in another format", async () => {
    const { brand, product } = await v3AtTruth(studio);
    const story = await callTool(studio, "batch_create", { kind: "v3", brandId: brand.id, productId: product.id, format: "other", formatNote: "9:16 story" });
    expect(story).toMatchObject({ ok: false, error: expect.stringMatching(/static 4:5/) });
  });
});
