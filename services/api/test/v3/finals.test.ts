import { FINAL_POINTS } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { fakeNet } from "../helpers/net.js";
import { PICKED, rules, v3AtDirected } from "../helpers/v3.js";

const SCENE = "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.";
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
const FONT_FILE = "https://fonts.gstatic.com/s/archivo/v19/archivo-800.ttf";

let studio: Studio;
let batchId: string;
let drafts: Record<string, string[]>;

const tick = () => (studio.clock.now = new Date(studio.clock.now.getTime() + 1000));
async function run(tool: string, args: object) {
  tick();
  const sent = await callTool(studio, tool, { ...rules, batchId, ...args });
  if (!sent.ok) return sent;
  return callTool(studio, "pixel_status", { batchId, jobId: sent.value.id });
}
async function render(ideaId: string, extra: object): Promise<string> {
  tick();
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, prompt: SCENE, references: ["pack-1"], ...extra });
  if (!sent.ok) throw new Error(sent.error);
  const read = await callTool(studio, "render_status", { batchId, renderId: sent.value.id });
  if ((await callTool(studio, "batch_get", { batchId })).value.batch.state === "waiting_spend") await callTool(studio, "spend_approve", { ...rules, batchId, ownerSaid: "yes" });
  return read.value.image.id as string;
}
async function checked(imageId: string) {
  await callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
  const job = await callTool(studio, "pack_check", { batchId, imageId, at: [500, 800], bg: "FFD21E" });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
}
/** Sets the approved words where the direction says, and looks at the picture with them. Returns the picture with its words. */
async function words(imageId: string): Promise<string> {
  const set = await run("type_set", { imageId, area: [0.06, 0.12, 0.5, 0.4], colour: "FFFFFF" });
  if (!set.ok) throw new Error(set.error);
  await callTool(studio, "checks_save", { ...rules, batchId, imageId: set.value.image.id, items: [] });
  return set.value.image.id as string;
}
const allPass = () => Object.fromEntries(FINAL_POINTS.map((point) => [point, { passed: true, note: "" }]));
const points = (imageId: string, change: object = {}) => callTool(studio, "final_points_save", { ...rules, batchId, imageId, points: { ...allPass(), ...change } });
const done = async () => (await callTool(studio, "batch_done", { batchId })).value;
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state as string;

/** A final of a concept as the owner would send it: picked, rendered, checked, finished, with its words. */
async function final(ideaId: string): Promise<string> {
  await callTool(studio, "pick_save", { batchId, ideaId, imageId: drafts[ideaId]![0], ownerSaid: "this one" });
  const imageId = await render(ideaId, { kind: "final", fromId: drafts[ideaId]![0] });
  await checked(imageId);
  await run("photo_finish", { imageId });
  return words(imageId);
}

/** A v3 batch with nine checked drafts that carry the approved words, ranked and shown. */
beforeEach(async () => {
  studio = await createStudio({
    net: fakeNet({ "https://fonts.googleapis.com/css2?family=Archivo:wght@800": { body: `@font-face { src: url(${FONT_FILE}) format('truetype'); }` }, [FONT_FILE]: { body: TTF } }),
  });
  await approvedClient(studio);
  const made = await v3AtDirected(studio);
  batchId = made.batchId;
  const font = await callTool(studio, "font_save", { brandId: made.brand.id, family: "Archivo", weight: 800 });
  if (!font.ok) throw new Error(font.error);
  drafts = {};
  for (const ideaId of PICKED) {
    for (const draft of [1, 2, 3]) {
      const imageId = await render(ideaId, { kind: "draft", draft });
      await checked(imageId);
      await words(imageId);
      (drafts[ideaId] ??= []).push(imageId);
    }
  }
  await rankDrafts(studio, batchId);
  const shown = await callTool(studio, "board_show", { batchId });
  if (!shown.ok) throw new Error(shown.error);
});

describe("a v3 batch: the board and the finals", () => {
  it("shows the owner each draft with its words and the question it asks", async () => {
    const board = (await callTool(studio, "board_show", { batchId })).value;
    expect(board.ideas.map((entry: { idea: { id: string } }) => entry.idea.id)).toEqual(PICKED);
    for (const entry of board.ideas) {
      expect(entry.drafts.map((draft: { question?: string }) => draft.question)).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
      expect(entry.drafts.every((draft: { words?: object }) => draft.words)).toBe(true);
    }
  });

  it("is finished only when each final passes its eight points", async () => {
    const finals: string[] = [];
    for (const ideaId of PICKED) finals.push(await final(ideaId));
    let report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finals" } });
    expect(JSON.stringify(report.conditions)).toMatch(new RegExp(`final_points_save for picture ${finals[0]}`));

    // The points are of the picture the owner would send, and a failed point says what is wrong.
    expect(await points(drafts["idea-2"]![0]!)).toMatchObject({ ok: false, error: expect.stringMatching(/not a finished final with its words/) });
    expect(await points(finals[0]!, { food: { passed: false, note: " " } })).toMatchObject({ ok: false, error: expect.stringMatching(/Say what is wrong for each failed point: food/) });

    await points(finals[0]!);
    await points(finals[1]!);
    const failed = await points(finals[2]!, { productTruth: { passed: false, note: "The pouch is wider than the real one at phone size." } });
    expect(failed.value).toMatchObject({ state: "finals", note: expect.stringMatching(/fails productTruth, so it is not delivered/) });
    report = await done();
    expect(report.done).toBe(false);
    expect(JSON.stringify(report.conditions)).toMatch(/a final of idea-5 that passes every point \(the newest fails productTruth\)/);
    const delivered = (await studio.services.board.finals(await studio.services.batches.get(batchId))).map((entry) => entry.delivered?.id);
    expect(delivered).toEqual([finals[0], finals[1], undefined]);

    expect((await points(finals[2]!)).value.state).toBe("finished");
  });

  it("lets him take a draft he passed on after the other finals are finished", async () => {
    await callTool(studio, "pick_save", { batchId, ideaId: "idea-2", imageId: null, ownerSaid: "none of these" });
    for (const ideaId of ["idea-4", "idea-5"]) await points(await final(ideaId));
    expect(await state()).toBe("finished");
    expect((await done()).done).toBe(false);
    tick();
    const again = await callTool(studio, "pick_save", { batchId, ideaId: "idea-2", imageId: drafts["idea-2"]![1], ownerSaid: "draft 2 after all" });
    expect(again.ok ? "" : again.error).toBe("");
    expect(await state()).toBe("finals");
    const imageId = await render("idea-2", { kind: "final", fromId: drafts["idea-2"]![1] });
    await checked(imageId);
    await run("photo_finish", { imageId });
    await points(await words(imageId));
    expect(await state()).toBe("finished");
  });

  it("takes a newer verdict of the owner over his earlier pass", async () => {
    const passed = await callTool(studio, "pick_save", { batchId, ideaId: "idea-2", imageId: null, ownerSaid: "none of these" });
    expect(passed.ok ? "" : passed.error).toBe("");
    const refused = await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-2", kind: "final", prompt: SCENE, fromId: drafts["idea-2"]![1], references: ["pack-1"] });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/passed on all the drafts of idea-2/) });
    // He looks again and takes draft 2: the concept is back, and its final can be made.
    tick();
    const again = await callTool(studio, "pick_save", { batchId, ideaId: "idea-2", imageId: drafts["idea-2"]![1], ownerSaid: "on second look, draft 2 works" });
    expect(again.value.pick).toMatchObject({ imageId: drafts["idea-2"]![1], first: { imageId: null } });
    const board = (await callTool(studio, "board_show", { batchId })).value;
    expect(board.ideas[0].pick).toMatchObject({ imageId: drafts["idea-2"]![1] });
    expect(await render("idea-2", { kind: "final", fromId: drafts["idea-2"]![1] })).toBeTruthy();
    expect(await state()).toBe("finals");
  });
});
