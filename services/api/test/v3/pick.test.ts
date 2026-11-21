import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { concept, review, reviewConcepts, roughOf, rules, v3AtConcepts } from "../helpers/v3.js";

let studio: Studio;
let batchId: string;
const start = async (create: object = {}) => {
  studio = await createStudio();
  await approvedClient(studio);
  ({ batchId } = await v3AtConcepts(studio, create));
};
beforeEach(() => start());

const three = (ids = ["idea-2", "idea-4", "idea-5"]) => ids.map((ideaId) => ({ ideaId, ownerSaid: `yes this one, ${ideaId} stops me` }));
const pick = (args: object = {}, as: { sub?: string } = {}) => callTool(studio, "concept_pick", { ...rules, batchId, picks: three(), ...args }, as);
const batch = async () => (await callTool(studio, "batch_get", { batchId })).value;
const logged = async () => (await studio.services.tasteLog.list()).filter((entry) => entry.batchId === batchId);
/** Every picked concept has a rough, and the critic recommends it. */
async function reviewed(ids = ["idea-2", "idea-4", "idea-5"]) {
  for (const ideaId of ids) await roughOf(studio, batchId, ideaId);
  return reviewConcepts(studio, batchId, ids);
}

describe("the owner's pick of three concepts", () => {
  it("is his alone, after the critic's review of the set as it is now", async () => {
    expect(await pick()).toMatchObject({ ok: false, error: expect.stringMatching(/review of every concept.*critic_open with step "concepts"/) });
    await reviewed();
    expect(await pick({}, { sub: "sub-member" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only the owner picks the concepts/) });
    expect((await batch()).batch.state).toBe("reviewed");
    // A rough made after the review takes the batch back: the critic has not seen it.
    await roughOf(studio, batchId, "idea-1");
    expect((await pick()).ok).toBe(false);
  });

  it("saves three concepts of any stage as the batch's ideas, with his words, and asks for his yes to the words next", async () => {
    await reviewed(["idea-1", "idea-4", "idea-5"]);
    // idea-1 and idea-4 are of one funnel stage.
    const saved = await pick({ picks: three(["idea-1", "idea-4", "idea-5"]), passes: [{ ideaId: "idea-3", ownerSaid: "too cute, nobody talks like this" }] });
    expect(saved.value).toMatchObject({ state: "judged", picked: [{ id: "idea-1" }, { id: "idea-4" }, { id: "idea-5" }], nextStep: expect.stringMatching(/copy_approve/) });
    expect(saved.value.warnings).toBeUndefined();
    const now = await batch();
    expect(now.ideas.map((idea: { id: string }) => idea.id)).toEqual(["idea-1", "idea-4", "idea-5"]);
    expect(now.nextStep).toMatch(/copy_approve/);
    expect(await studio.services.conceptPicks.get(batchId)).toMatchObject({ by: "owner@example.com", picks: three(["idea-1", "idea-4", "idea-5"]), passes: [{ ideaId: "idea-3" }] });
    const log = await logged();
    expect(log.filter((entry) => entry.kind === "pick").map((entry) => entry.ownerSaid).sort()).toEqual(three(["idea-1", "idea-4", "idea-5"]).map((entry) => entry.ownerSaid).sort());
    expect(log.filter((entry) => entry.kind === "pass")).toMatchObject([{ ownerSaid: "too cute, nobody talks like this", ideaId: "idea-3", about: expect.stringMatching(/WonGi, Seaweed crisps\. Concept "Concept 3".*Passed/) }]);
  });

  it("saves a pick the critic did not recommend, or one with no rough, with a warning", async () => {
    await roughOf(studio, batchId, "idea-2");
    await reviewConcepts(studio, batchId, ["idea-2"]);
    const saved = await pick();
    expect(saved.ok).toBe(true);
    expect(saved.value.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/idea-4 has no rough/), expect.stringMatching(/The critic did not recommend idea-5/)]));
    expect(saved.value.warnings.join(" ")).not.toMatch(/idea-2/);
    expect((await studio.services.conceptPicks.get(batchId))?.warnings).toHaveLength(4);
  });

  it("warns of a concept that stands on a hypothesis", async () => {
    await callTool(studio, "concepts_save", { ...rules, batchId, concepts: [concept(7, { territory: "Desk at four", insightId: "insight-4" })] });
    await reviewed(["idea-2", "idea-4", "idea-7"]);
    const saved = await pick({ picks: three(["idea-2", "idea-4", "idea-7"]) });
    expect(saved.value.warnings).toEqual([expect.stringMatching(/idea-7 stands on a hypothesis/)]);
  });

  it("refuses a pick that is not three known concepts, each once, each with his words", async () => {
    await reviewed();
    expect((await pick({ picks: three(["idea-2", "idea-4"]) })).ok).toBe(false);
    expect(await pick({ picks: three(["idea-2", "idea-2", "idea-4"]) })).toMatchObject({ ok: false, error: expect.stringMatching(/Give each concept once/) });
    expect(await pick({ passes: [{ ideaId: "idea-2", ownerSaid: "no" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/Give each concept once/) });
    expect(await pick({ picks: three(["idea-2", "idea-4", "idea-9"]) })).toMatchObject({ ok: false, error: expect.stringMatching(/no concept idea-9/) });
    expect(await pick({ picks: [...three(["idea-2", "idea-4"]), { ideaId: "idea-5", ownerSaid: "   " }] })).toMatchObject({ ok: false, error: expect.stringMatching(/owner's own words/) });
    expect((await batch()).batch.state).toBe("reviewed");
    expect(await logged()).toEqual([]);
  });

  it("can be changed until he approves the words, and logs only what is new", async () => {
    await reviewed(["idea-2", "idea-4", "idea-5", "idea-6"]);
    await pick();
    const again = await pick({ picks: three(["idea-2", "idea-4", "idea-6"]) });
    expect(again.value).toMatchObject({ state: "judged", picked: [{ id: "idea-2" }, { id: "idea-4" }, { id: "idea-6" }] });
    expect((await batch()).ideas.map((idea: { id: string }) => idea.id)).toEqual(["idea-2", "idea-4", "idea-6"]);
    expect((await logged()).map((entry) => entry.ideaId).sort()).toEqual(["idea-2", "idea-4", "idea-5", "idea-6"]);

    const words = (await batch()).ideas.map((idea: { id: string; headline: string; subline: string }) => ({ ideaId: idea.id, headline: idea.headline, subline: idea.subline, ownerSaid: "yes" }));
    expect(await callTool(studio, "copy_approve", { ...rules, batchId, ideas: words })).toMatchObject({ ok: true, value: { state: "worded" } });
    expect(await pick()).toMatchObject({ ok: false });
    expect((await batch()).ideas.map((idea: { id: string }) => idea.id)).toEqual(["idea-2", "idea-4", "idea-6"]);
  });

  it("warns of a recommended concept with a low score", async () => {
    await roughOf(studio, batchId, "idea-2");
    const packet = await callTool(studio, "critic_open", { batchId, step: "concepts", freshHelper: true });
    const reviews = packet.value.concepts.map((entry: { id: string }) =>
      review(entry.id, entry.id === "idea-2" ? { recommend: true, scores: { ...review("x").scores, headline: 2, commercial: 3 } } : {}),
    );
    expect(await callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews })).toMatchObject({ ok: true });
    const saved = await pick();
    expect(saved.ok).toBe(true);
    expect(saved.value.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/The critic scored idea-2 under 4 of 5 for headline, commercial\./)]));
  });

  it("makes no draft of a concept before its direction", async () => {
    await reviewed();
    await pick();
    const words = (await batch()).ideas.map((idea: { id: string; headline: string; subline: string }) => ({ ideaId: idea.id, headline: idea.headline, subline: idea.subline, ownerSaid: "yes" }));
    expect(await callTool(studio, "copy_approve", { ...rules, batchId, ideas: words })).toMatchObject({ ok: true, value: { state: "worded" } });
    const draft = await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-2", kind: "draft", prompt: "One empty pouch lies flat on a yellow seamless, one hard shadow to its right.", references: ["pack-1"] });
    expect(draft).toMatchObject({ ok: false, error: expect.stringMatching(/the batch is at "worded".*direction/) });
    expect((await batch()).batch.state).toBe("worded");
  });

  it("teaches the studio nothing in a test batch", async () => {
    await start({ test: true });
    await reviewed();
    const saved = await pick();
    expect(saved.value).toMatchObject({ state: "judged", note: expect.stringMatching(/test batch.*not in the taste log/) });
    expect(await logged()).toEqual([]);
  });
});
