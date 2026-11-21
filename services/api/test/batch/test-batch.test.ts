import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas, rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

// Found live (22-11-2026): a tester's picks in a batch made to try the studio went into the owner's taste log and into the calibration.
const rules = { rulesVersion: RULES_VERSION };
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";
const IDEAS = ["idea-1", "idea-2", "idea-3"];

let studio: Studio;
let batchId: string;
let drafts: Record<string, string>;

async function render(ideaId: string, kind: "draft" | "final", fromId?: string): Promise<string> {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, ...(fromId ? { fromId } : {}) });
  return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
}
const check = (imageId: string) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
const pick = (ideaId: string, imageId: string | null) => callTool(studio, "pick_save", { batchId, ideaId, imageId, ownerSaid: "the tester's choice, to reach the finals" });
const log = async () => (await callTool(studio, "taste_log", {})).value.entries as { batchId?: string }[];

/** A batch with nine checked and ranked drafts, and the board shown. */
async function batchAtBoard(create: object) {
  batchId = (await batchAtTruth(studio, create)).batchId;
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
  await judgeIdeas(studio, batchId);
  drafts = {};
  for (const ideaId of IDEAS) {
    for (let n = 0; n < 3; n++) {
      const imageId = await render(ideaId, "draft");
      await check(imageId);
      drafts[ideaId] ??= imageId;
    }
  }
  await rankDrafts(studio, batchId);
  await callTool(studio, "board_show", { batchId });
  // A pick counts in the calibration only when it comes after the rank.
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
}

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

describe("a test batch", () => {
  it("is a test only when it was made as one", async () => {
    const { batchId: plain } = await batchAtTruth(studio);
    expect((await callTool(studio, "batch_get", { batchId: plain })).value.batch.test).toBeUndefined();
    const { batchId: tried } = await batchAtTruth(studio, { test: true });
    expect((await callTool(studio, "batch_get", { batchId: tried })).value.batch.test).toBe(true);
  });

  it("keeps its picks out of the taste log and out of the calibration", async () => {
    await batchAtBoard({ test: true });
    const before = (await log()).length;
    for (const ideaId of IDEAS) {
      expect((await pick(ideaId, drafts[ideaId]!)).value).toMatchObject({ pick: { ideaId }, note: expect.stringMatching(/not in the taste log and not in the calibration/) });
    }
    expect(await pick("idea-3", null)).toMatchObject({ ok: true });
    expect((await log()).length).toBe(before);
    expect((await callTool(studio, "calibration_report", {})).value.picks).toMatchObject({ firstPlace: { n: 0 }, byPlace: {} });
  });

  it("still counts the picks of a batch that is not a test", async () => {
    await batchAtBoard({});
    const before = (await log()).length;
    await pick("idea-1", drafts["idea-1"]!);
    expect((await log()).length).toBe(before + 1);
    expect((await callTool(studio, "calibration_report", {})).value.picks).toMatchObject({ firstPlace: { n: 1 } });
  });

  it("is never marked done, though every condition holds", async () => {
    await batchAtBoard({ test: true });
    for (const ideaId of IDEAS) {
      await pick(ideaId, drafts[ideaId]!);
      const imageId = await render(ideaId, "final", drafts[ideaId]);
      await check(imageId);
      const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId });
      await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
    }
    const report = (await callTool(studio, "batch_done", { batchId })).value;
    expect(report.conditions.filter((entry: { passed: boolean }) => !entry.passed)).toEqual([]);
    expect(report).toMatchObject({ done: false, batch: { state: "finished", test: true }, nextStep: expect.stringMatching(/test batch.*never marked done.*Every condition holds/) });
    expect((await callTool(studio, "batch_get", { batchId })).value.nextStep).toMatch(/test batch is never marked done/);
  });
});
