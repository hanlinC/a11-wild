import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { PACK_CHECK } from "../../src/checks/store.js";
import { batchAtTruth, idea, judgeIdeas, rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { loadProspects } from "../outreach/helpers.js";

const rules = { rulesVersion: RULES_VERSION };
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";
const IDEAS = ["idea-1", "idea-2", "idea-3"];
const PROSPECT = "00001";

let studio: Studio;
let batchId: string;
let drafts: Record<string, string>;

async function render(ideaId: string, kind: "draft" | "final", fromId?: string): Promise<string> {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, ...(fromId ? { fromId } : {}) });
  return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
}
const check = (imageId: string, items: object[] = []) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
/** The agent's try to pick: the studio refuses it for an outreach batch. */
const agentPick = (ideaId: string, imageId: string | null) => callTool(studio, "pick_save", { batchId, ideaId, imageId, ownerSaid: "the agent's choice for an outreach ad" });
/** The owner's own pick on the prospect's page, after the agent has shown the drafts. */
async function ownerPicks(imageId: string) {
  await callTool(studio, "outreach_show", { batchId });
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  await studio.services.outreach.picks.pick(PROSPECT, imageId, "owner@studio.example");
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
}
const log = async () => (await callTool(studio, "taste_log", {})).value.entries as unknown[];

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
  if (!("prospectId" in create)) await rankDrafts(studio, batchId);
  await callTool(studio, "board_show", { batchId });
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
}

/** The picked draft of idea-1 as a final with its finish; the other two ideas passed on. */
async function oneFinal(items: object[] = []) {
  await ownerPicks(drafts["idea-1"]!);
  const imageId = await render("idea-1", "final", drafts["idea-1"]);
  await check(imageId, items);
  const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
}

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  await loadProspects(studio);
});

describe("an outreach batch", () => {
  it("is one only when it was made for a prospect, and never a test as well", async () => {
    const { batchId: plain, brand, product } = await batchAtTruth(studio);
    expect((await callTool(studio, "batch_get", { batchId: plain })).value.batch.purpose).toBeUndefined();
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id, prospectId: PROSPECT });
    expect(made.value.batch).toMatchObject({ purpose: "outreach", prospectId: PROSPECT });
    const both = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id, prospectId: PROSPECT, test: true });
    expect(both).toMatchObject({ ok: false, error: expect.stringMatching(/a test or an outreach batch, not both/) });
  });

  it("refuses the agent's pick, and keeps the owner's pick out of the taste log and out of the calibration", async () => {
    await batchAtBoard({ prospectId: PROSPECT });
    const before = (await log()).length;
    expect(await agentPick("idea-1", drafts["idea-1"]!)).toMatchObject({ ok: false, error: expect.stringMatching(/picked on the brand's page under Outreach/) });
    expect(await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-1", kind: "final", scene: SCENE, fromId: drafts["idea-1"] })).toMatchObject({ ok: false });
    await ownerPicks(drafts["idea-1"]!);
    const board = (await callTool(studio, "board_show", { batchId })).value;
    expect(board.ideas.map((entry: { pick: { imageId: string | null } }) => entry.pick.imageId)).toEqual([drafts["idea-1"], null, null]);
    expect((await log()).length).toBe(before);
    expect((await callTool(studio, "calibration_report", {})).value.picks).toMatchObject({ firstPlace: { n: 0 }, byPlace: {} });
  });

  it("saves no learning record and no brand note", async () => {
    const { batchId: made, brand } = await batchAtTruth(studio, { prospectId: PROSPECT });
    const lesson = await callTool(studio, "learn", { ...rules, observation: "The pouch read small.", source: "an outreach batch", scope: { kind: "craft" }, lesson: "Fill the frame.", evidence: 1, confidence: "low", examples: [], counterexamples: [], expectedEffect: "A larger pack.", batchId: made });
    expect(lesson).toMatchObject({ ok: false, error: expect.stringMatching(/An outreach batch teaches the studio nothing/) });
    const note = await callTool(studio, "brand_note", { ...rules, brandId: brand.id, note: "Likes yellow.", ownerSaid: "more yellow", batchId: made });
    expect(note).toMatchObject({ ok: false, error: expect.stringMatching(/An outreach batch teaches the studio nothing/) });
  });

  it("is done with one final that passes, and makes no client pack", async () => {
    await batchAtBoard({ prospectId: PROSPECT });
    await oneFinal();
    const report = (await callTool(studio, "batch_done", { batchId })).value;
    expect(report).toMatchObject({ done: true, batch: { state: "done", purpose: "outreach" }, nextStep: expect.stringMatching(/outreach_attach/) });
    const pack = await callTool(studio, "pack_publish", { ...rules, batchId, launchPlan: ["One ad set."] });
    expect(pack).toMatchObject({ ok: false, error: expect.stringMatching(/outreach batch.*no client pack/) });
  });

  describe("what the checks found", () => {
    const WIDER = { code: "D11" as const, note: "render H/W 0.955 (486 x 509 px); packshot H/W 1.000; difference -4.5%; FAIL at 2%" };
    const measure = (imageId: string) => studio.services.checks.measure(batchId, imageId, PACK_CHECK, WIDER);
    const view = async () => (await studio.services.outreach.picks.view((await studio.services.outreach.store.all()).find((file) => file.profile.id === PROSPECT)!, new Set()))!;

    it("warns the owner and blocks nothing: he picks the draft, its final is made, and the ad carries the warning", async () => {
      await batchAtBoard({ prospectId: PROSPECT });
      const picked = drafts["idea-1"]!;
      await measure(picked);
      await callTool(studio, "outreach_show", { batchId });
      const draft = (await view()).drafts.find((entry) => entry.imageId === picked)!;
      expect(draft.blocked).toBeUndefined();
      expect(draft.warning).toBe("The pack is drawn 5% wider than in its photo. The limit is 2%.");
      expect((await view()).drafts.filter((entry) => entry.warning)).toHaveLength(1);

      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      await studio.services.outreach.picks.pick(PROSPECT, picked, "owner@studio.example");
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      const final = await render("idea-1", "final", picked);
      await measure(final);
      expect((await check(final)).value.note).toMatch(/a check rejects nothing: the owner reads what you saved/);
      const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId: final });
      await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
      const report = (await callTool(studio, "batch_done", { batchId })).value;
      expect(report).toMatchObject({ done: true });
      expect(JSON.stringify(report)).toMatch(/the owner is warned of what its checks found/);
      const attached = (await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its rock." })).value;
      expect(attached.ad).toMatchObject({ picked: true, warning: "The pack is drawn 5% wider than in its photo. The limit is 2%." });
    });

    it("carries no warning on a final whose pack passed", async () => {
      await batchAtBoard({ prospectId: PROSPECT });
      await oneFinal();
      await callTool(studio, "batch_done", { batchId });
      expect((await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its rock." })).value.ad.warning).toBeUndefined();
    });

    it("blocks no draft for what the agent saw: the owner reads it, picks the draft, and its final is made", async () => {
      await batchAtBoard({ prospectId: PROSPECT });
      const picked = drafts["idea-1"]!;
      await measure(picked);
      await check(picked, [{ code: "D4", note: "Invented leaves at the left edge." }]);
      await callTool(studio, "outreach_show", { batchId });
      const shown = await view();
      expect(shown.drafts.filter((entry) => entry.blocked)).toHaveLength(0);
      const draft = shown.drafts.find((entry) => entry.imageId === picked)!;
      expect(draft.warning).toBe("The pack is drawn 5% wider than in its photo. The limit is 2%. The agent saw: Invented leaves at the left edge.");
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      await studio.services.outreach.picks.pick(PROSPECT, picked, "owner@studio.example");
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      const final = await render("idea-1", "final", picked);
      await check(final, [{ code: "D4", note: "Invented leaves at the left edge." }]);
      const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId: final });
      await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
      expect((await callTool(studio, "batch_done", { batchId })).value).toMatchObject({ done: true });
      const attached = (await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its rock." })).value;
      expect(attached.ad).toMatchObject({ picked: true, warning: "The agent saw: Invented leaves at the left edge." });
    });

    it("still needs each final looked at before it is done", async () => {
      await batchAtBoard({ prospectId: PROSPECT });
      await ownerPicks(drafts["idea-1"]!);
      await render("idea-1", "final", drafts["idea-1"]);
      expect((await callTool(studio, "batch_done", { batchId })).value).toMatchObject({ done: false });
    });

    it("still rejects in a batch made for a client: no final from that draft, and the owner's pick is told so", async () => {
      await batchAtBoard({});
      const picked = drafts["idea-1"]!;
      await measure(picked);
      const saved = await callTool(studio, "pick_save", { batchId, ideaId: "idea-1", imageId: picked, ownerSaid: "this one" });
      expect(saved.value.note).toMatch(/no final can be made from it/);
      expect(await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-1", kind: "final", prompt: SCENE, fromId: picked })).toMatchObject({ ok: false, error: expect.stringMatching(/R35/) });
    });
  });

  describe("the judgement of its ideas", () => {
    const judge = async (cut: string[]) => {
      const packet = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
      if (!packet.ok) return packet;
      const ideas = IDEAS.map((ideaId) => ({ ideaId, verdict: cut.includes(ideaId) ? "cut" : "keep", reason: "As a fresh helper saw it." }));
      return callTool(studio, "critic_pick", { ...rules, batchId, ticket: packet.value.ticket, ideas });
    };
    const withIdeas = async (create: object) => {
      batchId = (await batchAtTruth(studio, create)).batchId;
      await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
    };
    const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;

    it("goes on with one kept idea: it makes one ad, so a cut idea starts no new round", async () => {
      await withIdeas({ prospectId: PROSPECT });
      const reply = await judge(["idea-1", "idea-3"]);
      expect(reply.value).toMatchObject({ state: "judged", kept: ["idea-2"], cut: [{ ideaId: "idea-1" }, { ideaId: "idea-3" }], nextStep: expect.stringMatching(/starts no other critic/) });
      expect((await studio.services.batches.ideas(batchId)).map((entry) => entry.id)).toEqual(["idea-2"]);
    });

    it("is judged twice at most: the studio refuses a third critic, and the brand is parked", async () => {
      await withIdeas({ prospectId: PROSPECT });
      const first = await judge(IDEAS);
      expect(first.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/round 1 of 2.*once more/) });
      await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(4), idea(5), idea(6)] });
      const second = await judge(IDEAS);
      expect(second.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/round 2 of 2, the last.*parks the brand/) });
      await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(7), idea(8), idea(9)] });
      const third = await judge([]);
      expect(third).toMatchObject({ ok: false, error: expect.stringMatching(/judged 2 times.*Park it/) });
      expect(await state()).toBe("ideas");
    });

    it("owes the drafts of every kept idea, and no rank of them", async () => {
      await withIdeas({ prospectId: PROSPECT });
      expect((await judge(["idea-3"])).value).toMatchObject({ state: "judged", kept: ["idea-1", "idea-2"] });
      drafts = {};
      for (const ideaId of ["idea-1", "idea-2"]) {
        for (let n = 0; n < 3; n++) {
          // The drafts of one idea are not enough: the owner picks among the drafts of every kept idea.
          expect(await state()).not.toBe("checked");
          const imageId = await render(ideaId, "draft");
          await check(imageId);
          drafts[ideaId] ??= imageId;
        }
      }
      // No critic ranks the drafts of an outreach batch: the owner judges them.
      expect(await state()).toBe("checked");
      await ownerPicks(drafts["idea-2"]!);
      const imageId = await render("idea-2", "final", drafts["idea-2"]);
      await check(imageId);
      const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId });
      await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
      expect((await callTool(studio, "batch_done", { batchId })).value).toMatchObject({ done: true, batch: { state: "done" } });
    });

    it("counts the limit when the judgement comes too: three packets opened together give two judgements", async () => {
      await withIdeas({ prospectId: PROSPECT });
      const tickets: string[] = [];
      for (let n = 0; n < 3; n++) tickets.push((await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true })).value.ticket);
      const cutAll = (ticket: string) => callTool(studio, "critic_pick", { ...rules, batchId, ticket, ideas: IDEAS.map((ideaId) => ({ ideaId, verdict: "cut", reason: "As a fresh helper saw it." })) });
      expect((await cutAll(tickets[0]!)).ok).toBe(true);
      expect((await cutAll(tickets[1]!)).ok).toBe(true);
      expect(await cutAll(tickets[2]!)).toMatchObject({ ok: false, error: expect.stringMatching(/judged 2 times.*Park it/) });
      expect((await callTool(studio, "batch_get", { batchId })).value.batch.state).toBe("ideas");
    });

    it("leaves a client's batch as it was: every idea is kept before it goes on, and the studio counts no limit", async () => {
      await withIdeas({});
      for (let round = 0; round < 3; round++) {
        const reply = await judge(["idea-1"]);
        expect(reply.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/writes a new idea in place of each one/) });
      }
      expect((await judge([])).value).toMatchObject({ state: "judged" });
      expect(await studio.services.batches.ideas(batchId)).toHaveLength(3);
    });
  });

  it("spends from the campaign and not from the month", async () => {
    await batchAtBoard({ prospectId: PROSPECT });
    const spend = (await callTool(studio, "spend_get", { batchId })).value;
    expect(spend.monthUsd).toBe(0);
    expect(spend.campaign.usd).toBeGreaterThan(0);
    expect(spend.campaign.usd).toBe(spend.batchUsd);
  });
});
