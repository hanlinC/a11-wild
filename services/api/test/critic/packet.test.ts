import { beforeEach, describe, expect, it } from "vitest";
import { TICKET_MINUTES } from "../../src/critic/store.js";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas, rankDrafts } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

const rules = { rulesVersion: RULES_VERSION };
const refused = (pattern: RegExp) => ({ ok: false, error: expect.stringMatching(pattern) });
const WHY = "The rock reads at once and no other brand could run it.";
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";

let studio: Studio;
let batchId: string;

const open = (step: "ideas" | "drafts", freshHelper = true) => callTool(studio, "critic_open", { batchId, step, freshHelper });
const keepAll = (ticket: string, ideas = ["idea-1", "idea-2", "idea-3"]) =>
  callTool(studio, "critic_pick", { ...rules, batchId, ticket, ideas: ideas.map((ideaId) => ({ ideaId, verdict: "keep", reason: WHY })) });
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  batchId = (await batchAtTruth(studio)).batchId;
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
});

describe("the blind judgement of the ideas", () => {
  it("gives a fresh helper the ideas without their author's notes, and a ticket", async () => {
    const packet = (await open("ideas")).value;
    expect(packet.ideas.map((entry: { id: string }) => entry.id)).toEqual(["idea-1", "idea-2", "idea-3"]);
    expect(Object.keys(packet.ideas[0]).sort()).toEqual(["device", "elements", "focalPoint", "id", "references", "title", "visual"]);
    expect(JSON.stringify(packet)).not.toMatch(/coverTest|killTest|Only this brand sells the sea/);
    expect(packet).toMatchObject({ step: "ideas", brand: { name: "WonGi" }, product: { name: "Seaweed crisps" }, truthSheet: { version: 1 }, ticket: expect.any(String) });
    expect(JSON.stringify(packet)).not.toMatch(/gold/i);
  });

  it("covers AE5: says a blind critic is needed to a caller that is not a fresh helper, and takes no pick without a ticket", async () => {
    expect(await open("ideas", false)).toEqual(refused(/blind critic is needed.*tell the owner and stop/));
    expect(await keepAll("made-up-ticket")).toEqual(refused(/ticket is not valid/));
    expect(await state()).toBe("ideas");
    // Drafts cannot be made before the blind pick.
    expect(await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-1", kind: "draft", prompt: SCENE })).toEqual(refused(/batch is at "ideas".*critic_open/));
  });

  it("moves the batch to judged when all three ideas are kept, and takes a ticket once", async () => {
    const { ticket } = (await open("ideas")).value;
    expect((await keepAll(ticket)).value).toMatchObject({ state: "judged" });
    expect(await keepAll(ticket)).toEqual(refused(/already at "judged"|ticket is not valid/));
    expect((await callTool(studio, "batch_get", { batchId })).value.criticOnIdeas.verdicts).toHaveLength(3);
  });

  it("refuses a second use of a ticket", async () => {
    const { ticket } = (await open("ideas")).value;
    const cut = { ...rules, batchId, ticket, ideas: [{ ideaId: "idea-1", verdict: "cut", reason: WHY }, { ideaId: "idea-2", verdict: "keep", reason: WHY }, { ideaId: "idea-3", verdict: "keep", reason: WHY }] };
    expect((await callTool(studio, "critic_pick", cut)).value).toMatchObject({ state: "ideas", cut: [{ ideaId: "idea-1" }] });
    expect(await keepAll(ticket)).toEqual(refused(/ticket is not valid.*works once/));
    expect(await state()).toBe("ideas");
  });

  it("refuses a ticket that ran out, a pick that skips an idea, and a ticket made for other ideas", async () => {
    const first = (await open("ideas")).value.ticket;
    expect(await keepAll(first, ["idea-1", "idea-2"])).toEqual(refused(/Judge each idea of the packet once/));
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(4)] });
    expect(await keepAll(first)).toEqual(refused(/ideas of this batch changed/));
    const second = (await open("ideas")).value.ticket;
    studio.clock.now = new Date(studio.clock.now.getTime() + (TICKET_MINUTES + 1) * 60_000);
    expect(await keepAll(second)).toEqual(refused(/ticket is not valid/));
  });

});

describe("the blind rank of the drafts", () => {
  let drafts: Record<string, string[]>;
  const pick = (ideaId: string, imageId: string | null) => callTool(studio, "pick_save", { batchId, ideaId, imageId, ownerSaid: "this one, it is calm" });
  const ranks = (packet: { ideas: { idea: { id: string }; drafts: { imageId: string }[] }[] }, order = (ids: string[]) => ids) =>
    packet.ideas.map((entry) => ({ ideaId: entry.idea.id, order: order(entry.drafts.map((draft) => draft.imageId)).map((imageId) => ({ imageId, reason: WHY })) }));

  beforeEach(async () => {
    await judgeIdeas(studio, batchId);
    drafts = {};
    for (const ideaId of ["idea-1", "idea-2", "idea-3"]) {
      for (let n = 0; n < 3; n++) {
        studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
        const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind: "draft", prompt: SCENE });
        (drafts[ideaId] ??= []).push((await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id);
      }
    }
    for (const imageId of Object.values(drafts).flat()) await callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [{ code: "F6", note: "A little busy on the left." }] });
  });

  it("gives each idea's drafts with what a tool measured, and none of the agent's own notes", async () => {
    await studio.services.checks.measure(batchId, drafts["idea-1"]![0]!, "pack_check", { code: "D11", note: "The pouch is 5% wider than the packshot." });
    const packet = (await open("drafts")).value;
    expect(packet.ideas.map((entry: { drafts: unknown[] }) => entry.drafts.length)).toEqual([3, 3, 3]);
    expect(packet.ideas[0].drafts[0]).toEqual({ imageId: drafts["idea-1"]![0], shownId: drafts["idea-1"]![0], viewUrl: expect.any(String), measured: [{ code: "D11", note: "The pouch is 5% wider than the packshot.", tool: "pack_check" }] });
    expect(JSON.stringify(packet)).not.toMatch(/A little busy|killTest/);
  });

  it("refuses a rank without a ticket, with the ideas' ticket, or with a picture that is not a draft of the idea", async () => {
    const packet = (await open("drafts")).value;
    const rank = (ticket: string, list = ranks(packet)) => callTool(studio, "critic_rank", { ...rules, batchId, ticket, ranks: list });
    expect(await rank("made-up-ticket")).toEqual(refused(/ticket is not valid/));
    const swapped = ranks(packet);
    swapped[0]!.order[0]!.imageId = drafts["idea-2"]![0]!;
    expect(await rank(packet.ticket, swapped)).toEqual(refused(/Put every draft of idea-1 in the order once/));
    expect(await rank(packet.ticket, ranks(packet).slice(1))).toEqual(refused(/Judge each idea of the packet once/));
    expect((await rank(packet.ticket)).value).toMatchObject({ state: "checked", saved: ["idea-1", "idea-2", "idea-3"] });
    expect(await rank(packet.ticket)).toEqual(refused(/ticket is not valid/));
  });

  it("keeps the rank off the board until the owner has picked, and shows it for that idea only", async () => {
    const packet = (await open("drafts")).value;
    await callTool(studio, "critic_rank", { ...rules, batchId, ticket: packet.ticket, ranks: ranks(packet, (ids) => [...ids].reverse()) });
    const before = (await callTool(studio, "board_show", { batchId })).value;
    expect(before.ideas.map((entry: { rank: unknown }) => entry.rank)).toEqual([null, null, null]);
    expect(JSON.stringify(before)).not.toContain(WHY);
    await pick("idea-1", drafts["idea-1"]![0]!);
    const after = (await callTool(studio, "board_show", { batchId })).value;
    expect(after.ideas[0].rank.order.map((place: { imageId: string }) => place.imageId)).toEqual([...drafts["idea-1"]!].reverse());
    expect(after.ideas[1].rank).toBeNull();
  });

  it("holds no field that shows the owner's pick, and takes no rank for an idea he has chosen for", async () => {
    const early = (await open("drafts")).value;
    await rankDrafts(studio, batchId);
    await pick("idea-1", drafts["idea-1"]![1]!);
    await pick("idea-2", null);
    const packet = (await open("drafts")).value;
    expect(packet.ideas.map((entry: { idea: { id: string } }) => entry.idea.id)).toEqual(["idea-3"]);
    expect(JSON.stringify(packet)).not.toMatch(/"pick"|ownerSaid|it is calm|"order"|"rank"/);
    // A ticket from before his pick cannot rank the idea he has chosen for.
    expect(await callTool(studio, "critic_rank", { ...rules, batchId, ticket: early.ticket, ranks: ranks(early) })).toEqual(refused(/drafts of idea-1 cannot be ranked now: the owner has chosen/));
  });

  it("takes no rank of a draft that was repaired after the packet was made, and asks for a new rank after a later repair", async () => {
    // A repair as product_swap saves it: a new picture that stands for the draft, and that is checked again.
    const repair = async (ideaId: string, imageId: string) => {
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      return (await studio.services.images.add({ batchId, kind: "swap", key: `batches/${batchId}/swap-of-${imageId}.jpg`, ideaId, fromId: imageId, rootId: imageId })).id;
    };
    const check = (imageId: string) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
    const early = (await open("drafts")).value;
    const first = await repair("idea-1", drafts["idea-1"]![0]!);
    // The critic looked at the picture from before the repair.
    expect(await callTool(studio, "critic_rank", { ...rules, batchId, ticket: early.ticket, ranks: ranks(early) })).toEqual(refused(/A draft of idea-1 was repaired after your packet was made/));

    // A rank of the pictures as they are is saved. The batch waits for the check of the repair.
    const packet = (await open("drafts")).value;
    expect(packet.ideas[0].drafts[0]).toMatchObject({ imageId: drafts["idea-1"]![0], shownId: first });
    expect((await callTool(studio, "critic_rank", { ...rules, batchId, ticket: packet.ticket, ranks: ranks(packet) })).value).toMatchObject({ state: "drafting" });
    // A draft repaired after its rank needs a new rank before the batch moves on.
    const second = await repair("idea-2", drafts["idea-2"]![0]!);
    await check(first);
    expect((await check(second)).value).toMatchObject({ state: "drafting", stillMissing: [expect.stringMatching(/rank of the drafts of idea-2 as they are now/)] });
    expect((await rankDrafts(studio, batchId)).value).toMatchObject({ state: "checked" });
  });

  it("counts only the owner's first choice, which he made before he saw the critic's order", async () => {
    await rankDrafts(studio, batchId);
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    // His first choice was the critic's third place. He then saw the order and changed to its first place.
    await pick("idea-1", drafts["idea-1"]![2]!);
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const changed = (await pick("idea-1", drafts["idea-1"]![0]!)).value.pick;
    expect(changed).toMatchObject({ imageId: drafts["idea-1"]![0], first: { imageId: drafts["idea-1"]![2] } });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    expect((await pick("idea-1", drafts["idea-1"]![1]!)).value.pick.first).toMatchObject({ imageId: drafts["idea-1"]![2] });
    const report = (await callTool(studio, "calibration_report", {})).value;
    expect(report.picks).toMatchObject({ firstPlace: { k: 0, n: 1 }, byPlace: { "3": 1 } });
  });

  it("counts how often the owner picked the critic's first place", async () => {
    await rankDrafts(studio, batchId);
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await pick("idea-1", drafts["idea-1"]![0]!);
    await pick("idea-2", drafts["idea-2"]![2]!);
    await pick("idea-3", null);
    const report = (await callTool(studio, "calibration_report", {})).value;
    expect(report.picks).toEqual({ firstPlace: { k: 1, n: 2, value: 0.5, interval: expect.any(Array), note: expect.stringMatching(/small sample/) }, byPlace: { "1": 1, "3": 1 } });
  });
});
