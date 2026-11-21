import { beforeEach, describe, expect, it } from "vitest";
import { PACK_CHECK } from "../../src/board/service.js";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas, rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, config, createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";

const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";
const refused = (pattern: RegExp) => ({ ok: false, error: expect.stringMatching(pattern) });
const rules = { rulesVersion: RULES_VERSION };

let studio: Studio;
let batchId: string;
/** The picture ids of the drafts, by idea, in the order they were sent. */
let drafts: Record<string, string[]>;

async function render(ideaId: string, kind: "draft" | "final", fromId?: string) {
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, ...(fromId ? { fromId } : {}) });
  if (!sent.ok) return sent;
  return callTool(studio, "render_status", { batchId, renderId: sent.value.id });
}

/** A batch with nine finished drafts, none checked yet. */
async function batchWithDrafts() {
  studio = await createStudio();
  await approvedClient(studio);
  batchId = (await batchAtTruth(studio)).batchId;
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
  await judgeIdeas(studio, batchId);
  drafts = {};
  for (const ideaId of ["idea-1", "idea-2", "idea-3"]) {
    for (let n = 0; n < 3; n++) {
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      (drafts[ideaId] ??= []).push((await render(ideaId, "draft")).value.image.id);
    }
  }
}

const check = (imageId: string, items: object[] = []) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
/** Every draft looked at, and each idea's drafts ranked by the blind critic. */
const checkAll = async () => {
  for (const imageId of Object.values(drafts).flat()) await check(imageId);
  await rankDrafts(studio, batchId);
};
const pick = (ideaId: string, imageId: string | null, ownerSaid = "this one, the rock reads at once", as: { sub?: string } = {}) =>
  callTool(studio, "pick_save", { batchId, ideaId, imageId, ownerSaid }, as);
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;

beforeEach(batchWithDrafts);

describe("checks", () => {
  it("gives the meaning of every D and F code with the house rules", async () => {
    const got = await callTool(studio, "rules_get", { role: "main", kind: "v1" });
    expect(Object.keys(got.value.pictureChecks)).toHaveLength(19);
    expect(got.value.pictureChecks.D11).toMatch(/pack_check, 2%/);
    expect(got.value.pictureChecks.D1).toMatch(/^Writing in the picture\. No readable words/);
    // An ad with words: the owner's approved words, set by type_set, are not the D1 defect.
    const worded = await callTool(studio, "rules_get", { role: "critic", kind: "v2" });
    expect(worded.value.pictureChecks.D1).toMatch(/owner's approved headline, subline and footnote that type_set put on the picture.*no word the model drew/);
    expect(Object.keys(worded.value.pictureChecks)).toHaveLength(19);
  });

  it("moves the batch to checked only when every draft was looked at, and names what is missing", async () => {
    const [first, ...rest] = Object.values(drafts).flat();
    const one = await check(first!, [{ code: "F6", note: "Seven things to look at." }]);
    expect(one.value).toMatchObject({ state: "drafting", checks: { looked: true, items: [{ code: "F6" }] } });
    // Eight more looks, and the blind critic's rank of each idea's drafts.
    expect(one.value.stillMissing).toHaveLength(11);
    expect(await callTool(studio, "board_show", { batchId })).toEqual(refused(/board is not ready.*checks_save for picture/));
    // The dashboard shows the drafts so far, and tells the owner that he cannot pick yet.
    const early = await json(await studio.app.request(`/api/batches/${batchId}/board`, { headers: { cookie: await sessionCookie(studio) } }));
    expect(early.picking).toBe("not_yet");
    for (const imageId of rest) await check(imageId);
    expect(await state()).toBe("drafting");
    expect(await callTool(studio, "board_show", { batchId })).toEqual(refused(/still missing: the blind critic's rank of the drafts of idea-1/i));
    expect((await rankDrafts(studio, batchId)).value).toMatchObject({ state: "checked", saved: ["idea-1", "idea-2", "idea-3"] });
  });

  it("keeps a D item that a tool measured: the agent's save cannot remove it", async () => {
    const [first] = drafts["idea-1"]!;
    await studio.services.checks.measure(batchId, first!, PACK_CHECK, { code: "D11", note: "The pouch is 5% wider than the packshot." });
    const saved = await check(first!, []);
    expect(saved.value.checks.items).toEqual([{ code: "D11", note: "The pouch is 5% wider than the packshot.", tool: PACK_CHECK }]);
    expect(saved.value.note).toMatch(/has D11, so it cannot become a final/);
    // A new measure that passes is the only thing that clears it.
    expect((await studio.services.checks.measure(batchId, first!, PACK_CHECK, null)).items).toEqual([]);
  });

  it("asks for the pack measure on every draft of a product that has a pack photo", async () => {
    const product = await studio.services.brands.product((await studio.services.batches.get(batchId)).productId);
    await studio.services.brands.saveProduct({ ...product, photos: [...product.photos, { key: "products/p/pack.png", sourceUrl: "https://cdn.wongi.example/pack.png", kind: "pack" }] });
    await checkAll();
    expect(await state()).toBe("drafting");
    for (const imageId of Object.values(drafts).flat()) await studio.services.checks.measure(batchId, imageId, PACK_CHECK, null);
    expect((await callTool(studio, "board_show", { batchId })).value.batch.state).toBe("waiting_pick");
  });

  it("refuses checks for a picture that is not a draft or a final, and from a caller that did not read the rules", async () => {
    const skeleton = await studio.services.images.add({ batchId, kind: "skeleton", key: "batches/b/skeletons/s.png" });
    expect(await check(skeleton.id)).toEqual(refused(/is a skeleton/));
    expect(await callTool(studio, "checks_save", { batchId, imageId: drafts["idea-1"]![0], items: [] })).toEqual(refused(/Call rules_get/));
  });
});

describe("pick board", () => {
  beforeEach(checkAll);

  it("shows each idea's three drafts numbered in the order they were sent, with no rank, beside the truth sheet", async () => {
    const board = (await callTool(studio, "board_show", { batchId })).value;
    expect(board.batch.state).toBe("waiting_pick");
    expect(board.truthSheet).toMatchObject({ version: 1 });
    expect(board.ideas).toHaveLength(3);
    for (const entry of board.ideas) {
      expect(entry.drafts.map((draft: { number: number }) => draft.number)).toEqual([1, 2, 3]);
      expect(entry.drafts.map((draft: { image: { id: string } }) => draft.image.id)).toEqual(drafts[entry.idea.id]);
      expect(entry.pick).toBeNull();
      // The blind critic has ranked these drafts. The board keeps that from him until he has picked.
      expect(entry.rank).toBeNull();
    }
    expect(JSON.stringify(board)).not.toMatch(/"order"|score|only this brand could run it/i);
  });

  it("saves the owner's pick with his words to the taste log, and refuses a member's", async () => {
    await callTool(studio, "board_show", { batchId });
    expect(await pick("idea-1", drafts["idea-1"]![1]!, "this one", { sub: "sub-member" })).toEqual(refused(/Only the owner picks/));
    expect(await pick("idea-1", drafts["idea-2"]![0]!)).toEqual(refused(/not a draft of idea-1/));
    expect((await pick("idea-1", drafts["idea-1"]![1]!)).value.pick).toMatchObject({ ideaId: "idea-1", imageId: drafts["idea-1"]![1], by: "owner@example.com" });
    const log = (await callTool(studio, "taste_log", {})).value.entries;
    expect(log[0]).toMatchObject({ kind: "pick", ownerSaid: "this one, the rock reads at once", about: "WonGi, Seaweed crisps. Idea 1: draft 2 of 3.", batchId, ideaId: "idea-1", draftId: drafts["idea-1"]![1] });
  });

  it("saves a pass on all three drafts with the owner's note", async () => {
    await pick("idea-2", null, "none of these: the wave hides the pack");
    const log = (await callTool(studio, "taste_log", {})).value.entries;
    expect(log[0]).toMatchObject({ kind: "pass", ownerSaid: "none of these: the wave hides the pack", about: expect.stringMatching(/passed on all 3 drafts/) });
    expect((await callTool(studio, "board_show", { batchId })).value.ideas[1].pick).toMatchObject({ imageId: null });
  });

  it("replaces a pick with a second one for the same idea and keeps both in the log", async () => {
    await pick("idea-1", drafts["idea-1"]![0]!, "first thought");
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await pick("idea-1", drafts["idea-1"]![2]!, "no, the third: calmer");
    expect((await callTool(studio, "board_show", { batchId })).value.ideas[0].pick).toMatchObject({ imageId: drafts["idea-1"]![2] });
    const log = (await callTool(studio, "taste_log", {})).value.entries.filter((entry: { ideaId?: string }) => entry.ideaId === "idea-1");
    expect(log.map((entry: { ownerSaid: string }) => entry.ownerSaid)).toEqual(["no, the third: calmer", "first thought"]);
  });

  it("gives the board to a signed-in dashboard and takes the owner's pick there, from the same origin only", async () => {
    const path = `/api/batches/${batchId}/board`;
    expect((await studio.app.request(path)).status).toBe(401);
    const board = await json(await studio.app.request(path, { headers: { cookie: await sessionCookie(studio) } }));
    expect(board.ideas[0].drafts[0].viewUrl).toContain("signed=1");
    expect(board.picking).toBe("open");

    const post = (cookie: string, origin: string) =>
      studio.app.request(`/api/batches/${batchId}/picks`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ ideaId: "idea-1", imageId: drafts["idea-1"]![0], ownerSaid: "the first" }),
      });
    expect((await post(await sessionCookie(studio, "member"), config.publicOrigin)).status).toBe(403);
    expect((await post(await sessionCookie(studio), "https://evil.example")).status).toBe(403);
    expect((await post(await sessionCookie(studio), config.publicOrigin)).status).toBe(200);
    expect(await state()).toBe("waiting_pick");
  });
});

describe("finals", () => {
  beforeEach(async () => {
    await checkAll();
    await callTool(studio, "board_show", { batchId });
  });

  it("makes a final only from the draft the owner picked", async () => {
    expect(await render("idea-1", "final", drafts["idea-1"]![0])).toEqual(refused(/R24.*has not picked a draft of idea-1/));
    await pick("idea-1", drafts["idea-1"]![1]!);
    expect(await render("idea-1", "final", drafts["idea-1"]![0])).toEqual(refused(/R24.*he picked picture/));
    await pick("idea-2", null, "none");
    expect(await render("idea-2", "final", drafts["idea-2"]![0])).toEqual(refused(/R24.*passed on all the drafts/));

    const final = await render("idea-1", "final", drafts["idea-1"]![1]);
    expect(final.value).toMatchObject({ kind: "final", status: "done", image: { kind: "final", fromId: drafts["idea-1"]![1] } });
    expect(studio.fal.submits().at(-1)?.body).toMatchObject({ image_size: { width: 1536, height: 1920 }, quality: "high" });
    expect(await state()).toBe("finals");
  });

  it("covers AE4: refuses a final for a picked draft with a D item, and names the item", async () => {
    const picked = drafts["idea-1"]![0]!;
    await studio.services.checks.measure(batchId, picked, PACK_CHECK, { code: "D11", note: "The pouch is 5% wider than the packshot." });
    expect((await pick("idea-1", picked)).value.note).toMatch(/has D11.*no final can be made/);
    expect(await render("idea-1", "final", picked)).toEqual(refused(/R35: this draft has D11 \(The pouch is 5% wider than the packshot\.\)/));
  });

  it("moves the batch to finished when every picked idea has a checked final with no D item", async () => {
    await pick("idea-1", drafts["idea-1"]![0]!);
    await pick("idea-2", null, "none");
    await pick("idea-3", drafts["idea-3"]![2]!);
    const first = await render("idea-1", "final", drafts["idea-1"]![0]);
    expect(first.value.note).toMatch(/2 finals come to about US\$0\.15, under US\$1/);
    const bad = await check(first.value.image.id, [{ code: "D10", note: "The pack keeps its studio highlight." }]);
    expect(bad.value).toMatchObject({ state: "finals", stillMissing: expect.arrayContaining([expect.stringMatching(/^a finished final of idea-3, from the picked draft/)]) });

    const third = await render("idea-3", "final", drafts["idea-3"]![2]);
    await check(third.value.image.id);
    expect(await state()).toBe("finals");
    // The failed final is made again; the newest one is the one that counts.
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const again = await render("idea-1", "final", drafts["idea-1"]![0]);
    // Checked, but not yet finished: each final still needs its real-camera finish.
    expect((await check(again.value.image.id)).value).toMatchObject({
      state: "finals",
      stillMissing: [`photo_finish for picture ${again.value.image.id}`, `photo_finish for picture ${third.value.image.id}`],
    });
    const finish = async (imageId: string) => {
      const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId });
      return (await callTool(studio, "pixel_status", { batchId, jobId: job.value.id })).value;
    };
    expect((await finish(again.value.image.id)).state).toBe("finals");
    expect((await finish(third.value.image.id)).state).toBe("finished");

    // A D item found after the end takes the batch back to its finals.
    expect((await check(third.value.image.id, [{ code: "D2", note: "The fish skin has no curry leaf." }])).value).toMatchObject({ state: "finals" });
    expect((await check(third.value.image.id)).value).toMatchObject({ state: "finished" });
  });

  const finished = async (ideaId: string, draftId: string, items: object[] = []) => {
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const final = await render(ideaId, "final", draftId);
    await check(final.value.image.id, items);
    const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId: final.value.image.id });
    return (await callTool(studio, "pixel_status", { batchId, jobId: job.value.id })).value;
  };

  it("does not finish while an idea has no pick and no pass", async () => {
    await pick("idea-1", drafts["idea-1"]![0]!);
    await pick("idea-2", null, "none");
    expect(await finished("idea-1", drafts["idea-1"]![0]!)).toMatchObject({ state: "finals", stillMissing: ["the owner's pick, or his pass, for idea-3"] });
    await pick("idea-3", null, "none of these");
    expect((await check(drafts["idea-1"]![1]!)).value.state).toBe("finished");
  });

  it("does not finish on a final with two F items, or on the final of a draft he no longer picks", async () => {
    await pick("idea-1", drafts["idea-1"]![0]!);
    await pick("idea-2", null, "none");
    await pick("idea-3", null, "none");
    const faults = [{ code: "F1", note: "The rope sags too far." }, { code: "F2", note: "The plinth edge is soft." }];
    expect(await finished("idea-1", drafts["idea-1"]![0]!, faults)).toMatchObject({ state: "finals", stillMissing: ["a final of idea-1 with fewer than two F items"] });
    await pick("idea-1", drafts["idea-1"]![1]!, "the second one after all");
    expect((await check(drafts["idea-1"]![1]!)).value).toMatchObject({ state: "finals", stillMissing: [expect.stringMatching(/a finished final of idea-1, from the picked draft/)] });
    expect((await finished("idea-1", drafts["idea-1"]![1]!)).state).toBe("finished");
  });
});
