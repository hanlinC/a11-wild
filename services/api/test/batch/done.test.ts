import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas, rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";

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
const check = (imageId: string, items: object[] = []) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
const pick = (ideaId: string, imageId: string | null) => callTool(studio, "pick_save", { batchId, ideaId, imageId, ownerSaid: "this one, it is calm" });
/** A final of the idea's picked draft, checked and finished. */
async function final(ideaId: string, items: object[] = []) {
  const imageId = await render(ideaId, "final", drafts[ideaId]);
  await check(imageId, items);
  const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
  return imageId;
}
const done = async () => (await callTool(studio, "batch_done", { batchId })).value;
const condition = (report: { conditions: { name: string }[] }, name: string) => report.conditions.find((entry) => entry.name === name);

/** A batch whose nine drafts are checked and ranked, with the board shown. */
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  batchId = (await batchAtTruth(studio)).batchId;
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
});

describe("the done gate", () => {
  it("is not done with two picks out of three ideas, and names the idea without a pick", async () => {
    await pick("idea-1", drafts["idea-1"]!);
    await pick("idea-2", drafts["idea-2"]!);
    await final("idea-1");
    await final("idea-2");
    const report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finals" }, nextStep: expect.stringMatching(/Not met: picks/) });
    expect(condition(report, "picks")).toMatchObject({ passed: false, evidence: "idea-3: no pick yet" });
    expect(condition(report, "finals")).toMatchObject({ passed: true });
  });

  it("is not done when the owner passed on an idea: that idea has no final", async () => {
    await pick("idea-1", drafts["idea-1"]!);
    await pick("idea-2", drafts["idea-2"]!);
    await pick("idea-3", null);
    await final("idea-1");
    await final("idea-2");
    const report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finished" } });
    expect(condition(report, "picks")).toMatchObject({ passed: false, evidence: expect.stringMatching(/idea-3: he passed on all its drafts/) });
  });

  it("is not done when a final failed the cap check", async () => {
    for (const ideaId of IDEAS) await pick(ideaId, drafts[ideaId]!);
    await final("idea-1");
    await final("idea-2");
    const third = await final("idea-3");
    await studio.services.checks.measure(batchId, third, "cap_check", { code: "D11", note: "The cap is 12% too flat." });
    const report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finals" } });
    expect(condition(report, "finals")).toMatchObject({ passed: false, evidence: expect.stringMatching(/a final of idea-3 with no D item \(the newest has D11\)/) });
  });

  it("is done with three clean finals, and lists the stranger test", async () => {
    for (const ideaId of IDEAS) await pick(ideaId, drafts[ideaId]!);
    for (const ideaId of IDEAS) await final(ideaId);
    const report = await done();
    expect(report).toMatchObject({ done: true, batch: { state: "done" }, nextStep: expect.stringMatching(/he runs that test himself/) });
    expect(report.conditions.map((entry: { name: string; passed: boolean }) => [entry.name, entry.passed])).toEqual([["picks", true], ["finals", true]]);
    expect(report.strangerTest).toEqual(expect.arrayContaining([expect.stringMatching(/person who does not know the brand/), expect.stringMatching(/would a company pay for this/)]));
    // Asking again changes nothing.
    expect(await done()).toMatchObject({ done: true, batch: { state: "done" } });
  });

  it("is not done any more when a final gets a D item after the batch was done, and takes a new final", async () => {
    for (const ideaId of IDEAS) await pick(ideaId, drafts[ideaId]!);
    const finals: Record<string, string> = {};
    for (const ideaId of IDEAS) finals[ideaId] = await final(ideaId);
    expect(await done()).toMatchObject({ done: true, batch: { state: "done" } });
    await studio.services.checks.measure(batchId, finals["idea-2"]!, "cap_check", { code: "D11", note: "The cap is 12% too flat." });
    const report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finals" }, nextStep: expect.stringMatching(/Not met: finals/) });
    expect(condition(report, "finals")).toMatchObject({ passed: false, evidence: expect.stringMatching(/idea-2 with no D item/) });
    // A new final of the same pick closes it again.
    await final("idea-2");
    expect(await done()).toMatchObject({ done: true, batch: { state: "done" } });
  });

  it("gives the dashboard the same conditions with the same results, and changes nothing", async () => {
    for (const ideaId of IDEAS) await pick(ideaId, drafts[ideaId]!);
    for (const ideaId of IDEAS) await final(ideaId);
    const page = await json(await studio.app.request(`/api/batches/${batchId}/done`, { headers: { cookie: await sessionCookie(studio) } }));
    expect(page).toMatchObject({ done: false, batch: { state: "finished" } });
    const report = await done();
    expect(page.conditions).toEqual(report.conditions);
    expect(page.strangerTest).toEqual(report.strangerTest);
  });
});
