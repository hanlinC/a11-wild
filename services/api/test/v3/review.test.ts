import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { concept, review, reviewConcepts, roughOf, rules, v3AtConcepts } from "../helpers/v3.js";

let studio: Studio;
let batchId: string;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  ({ batchId } = await v3AtConcepts(studio));
});

const open = () => callTool(studio, "critic_open", { batchId, step: "concepts", freshHelper: true });
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state as string;
const all = (packet: { value?: { concepts: { id: string }[] } }, extra: (ideaId: string) => object = () => ({})) => (packet.value?.concepts ?? []).map((entry) => review(entry.id, extra(entry.id)));

describe("the critic's review of the concepts", () => {
  it("gets every concept in another order, with its roughs as pictures and none of the writer's own answers", async () => {
    const roughId = await roughOf(studio, batchId, "idea-2");
    const packet = await open();
    expect(packet.value.step).toBe("concepts");
    expect(packet.value.readFirst).toMatch(/references_get/);
    const ids = packet.value.concepts.map((entry: { id: string }) => entry.id);
    expect([...ids].sort()).toEqual(["idea-1", "idea-2", "idea-3", "idea-4", "idea-5", "idea-6"]);
    expect(ids).not.toEqual(["idea-1", "idea-2", "idea-3", "idea-4", "idea-5", "idea-6"]);
    // The order is the same for one set.
    expect((await open()).value.concepts.map((entry: { id: string }) => entry.id)).toEqual(ids);
    const second = packet.value.concepts.find((entry: { id: string }) => entry.id === "idea-2");
    expect(second.roughs).toEqual([{ imageId: roughId, viewUrl: expect.stringMatching(/^https:\/\//) }]);
    expect(second).toMatchObject({ territory: "Territory 3", proposition: "You will not share it.", headline: "Gone again B" });
    // The buyer's words behind a concept are in the packet: the critic scores the insight from them.
    expect(second.insight).toMatchObject({ text: expect.any(String), basis: expect.stringMatching(/evidence|interpretation|hypothesis/) });
    expect(packet.value.concepts.some((entry: { insight: { quote?: string } }) => entry.insight.quote)).toBe(true);
    const text = JSON.stringify(packet.value.concepts);
    for (const hidden of ["pictureAlone", "headlineAlone", "killTest", "coverTest", "risks", "Someone finished the pack."]) expect(text).not.toContain(hidden);
  });

  it("is saved once for every concept, and takes the batch to reviewed", async () => {
    await roughOf(studio, batchId, "idea-2");
    const saved = await reviewConcepts(studio, batchId, ["idea-2"]);
    expect(saved.value).toMatchObject({ state: "reviewed", recommended: ["idea-2"], nextStep: expect.stringMatching(/he picks three \(concept_pick\)/) });
    expect((await callTool(studio, "batch_get", { batchId })).value.nextStep).toMatch(/concept_pick/);
    const kept = await studio.services.critic.conceptReviewsOf(batchId);
    expect(kept?.reviews).toHaveLength(6);
    expect(kept?.reviews.find((entry) => entry.ideaId === "idea-2")?.roughs).toHaveLength(1);
    expect(kept?.reviews.find((entry) => entry.ideaId === "idea-1")?.roughs).toEqual([]);
  });

  it("may recommend none, and the batch still goes to the owner with its notes", async () => {
    const saved = await reviewConcepts(studio, batchId);
    expect(saved.value).toMatchObject({ state: "reviewed", recommended: [], nextStep: expect.stringMatching(/no concept reaches the bar/) });
  });

  it("cannot recommend a concept with no rough, a weak picture or a failed point test", async () => {
    await roughOf(studio, batchId, "idea-2");
    await roughOf(studio, batchId, "idea-3");
    const packet = await open();
    const send = (extra: (ideaId: string) => object) => callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet, extra) });
    expect(await send((ideaId) => (ideaId === "idea-1" ? { recommend: true } : {}))).toMatchObject({ ok: false, error: expect.stringMatching(/idea-1 cannot be recommended: it has no rough/) });
    const weak = { ...review("x").scores, visual: 3 };
    expect(await send((ideaId) => (ideaId === "idea-2" ? { recommend: true, scores: weak } : {}))).toMatchObject({ ok: false, error: expect.stringMatching(/its picture scores 3, under 4/) });
    expect(await send((ideaId) => (ideaId === "idea-3" ? { recommend: true, pointTest: { passed: false, note: "The headline points at nothing." } } : {}))).toMatchObject({ ok: false, error: expect.stringMatching(/fails the point test/) });
    expect(await state()).toBe("ideas");
    // A refused review did not spend the ticket.
    expect((await send((ideaId) => (ideaId === "idea-2" ? { recommend: true } : {}))).ok).toBe(true);
  });

  it("must cover each concept once, with a ticket that works once", async () => {
    const packet = await open();
    const short = await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet).slice(1) });
    expect(short).toMatchObject({ ok: false, error: expect.stringMatching(/Review each concept of the packet once/) });
    expect((await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet) })).ok).toBe(true);
    const again = await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet) });
    expect(again.ok).toBe(false);
    expect(await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: "no-such-ticket", reviews: all(packet) })).toMatchObject({ ok: false });
  });

  it("refuses a review made before a rough or a concept was added", async () => {
    const packet = await open();
    await roughOf(studio, batchId, "idea-1");
    const stale = await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet) });
    expect(stale).toMatchObject({ ok: false, error: expect.stringMatching(/A concept or a rough was added after this ticket was made/) });

    const next = await open();
    await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(7, { territory: "Desk at four", insightId: "insight-4" })] });
    const older = await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: next.value.ticket, reviews: all(next) });
    expect(older).toMatchObject({ ok: false, error: expect.stringMatching(/added after this ticket/) });
    expect(await state()).toBe("ideas");
  });

  it("waits for a rough that is still being made", async () => {
    const packet = await open();
    const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-1", kind: "rough", prompt: "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.", references: ["pack-1"] });
    expect(sent.value.status).toBe("queued");
    expect(await open()).toMatchObject({ ok: false, error: expect.stringMatching(/A rough is still being made \(idea-1\)/) });
    const early = await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews: all(packet) });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/A rough is still being made/) });
    await callTool(studio, "render_status", { batchId, renderId: sent.value.id });
    expect((await open()).value.concepts.find((entry: { id: string }) => entry.id === "idea-1").roughs).toHaveLength(1);
  });

  it("goes back to the concepts when a rough or a concept is added after it", async () => {
    await reviewConcepts(studio, batchId);
    expect(await state()).toBe("reviewed");
    await roughOf(studio, batchId, "idea-1");
    expect(await state()).toBe("ideas");
    await reviewConcepts(studio, batchId);
    expect(await state()).toBe("reviewed");
    await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(7, { territory: "Desk at four", insightId: "insight-4" })] });
    expect(await state()).toBe("ideas");
    expect((await open()).value.concepts).toHaveLength(7);
  });

  it("is for a fresh helper and a batch of concept ads only", async () => {
    expect(await callTool(studio, "critic_open", { batchId, step: "concepts", freshHelper: false })).toMatchObject({ ok: false });
    expect(await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true })).toMatchObject({ ok: false, error: expect.stringMatching(/reviewed with step "concepts"/) });
  });
});
