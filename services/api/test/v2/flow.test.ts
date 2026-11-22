import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { idea, rankDrafts, readTaste, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { fakeNet } from "../helpers/net.js";
import { loadProspects } from "../outreach/helpers.js";

const rules = { rulesVersion: RULES_VERSION };
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it. The top third is plain dark sky.";
const STAGES = ["tof", "mof", "bof"] as const;
const WHY = "It reads at once, and only this brand could run it.";
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Archivo:wght@800";
const FONT_FILE = "https://fonts.gstatic.com/s/archivo/v19/archivo-800.ttf";
const SUB_CSS = "https://fonts.googleapis.com/css2?family=Inter:wght@500";
const SUB_FILE = "https://fonts.gstatic.com/s/inter/v20/inter-500.ttf";
const net = () =>
  fakeNet({
    [FONT_CSS]: { body: `@font-face { font-family: 'Archivo'; src: url(${FONT_FILE}) format('truetype'); }` },
    [FONT_FILE]: { body: TTF },
    [SUB_CSS]: { body: `@font-face { font-family: 'Inter'; src: url(${SUB_FILE}) format('truetype'); }` },
    [SUB_FILE]: { body: TTF },
  });

let studio: Studio;
let batchId: string;
let brandId: string;

/** One idea with words. Number n of 24: eight for each stage. */
const letter = (n: number) => String.fromCharCode(64 + n);
const worded = (n: number, extra: object = {}) =>
  idea(n, { stage: STAGES[n % 3], headline: `Headline ${letter(n)}`, subline: `The subline of idea ${letter(n)}.`, claims: [], shows: ["pack-1"], ...extra });
const burst = (extra: (n: number) => object = () => ({})) => Array.from({ length: 24 }, (_, index) => worded(index + 1, extra(index + 1)));

const PACK = { key: "products/p/pack.jpg", sourceUrl: "https://cdn.wongi.example/pack.jpg", kind: "pack" as const };
const SLICE = { key: "products/p/slice.jpg", sourceUrl: "https://cdn.wongi.example/slice.jpg", kind: "food" as const };

async function v2Batch(photos: (typeof PACK | typeof SLICE)[] = [PACK], create: object = {}) {
  const brand = await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: { key: "brands/b/logo.png", sourceUrl: "https://wongi.example/logo.png" }, palette: [], fonts: ["Archivo"], savedBy: "owner@example.com" });
  const product = await studio.services.brands.saveProduct({ brandId: brand.id, name: "Seaweed crisps", url: "https://wongi.example/products/seaweed-crisps", photos, savedBy: "owner@example.com" });
  const made = await callTool(studio, "batch_create", { kind: "v2", brandId: brand.id, productId: product.id, ...create });
  brandId = brand.id;
  batchId = made.value.batch.id as string;
  await callTool(studio, "truth_save", { batchId, ...sheet });
  return product;
}

/** The fresh critic chooses the first idea of each stage in its packet. */
async function choose(refuse: string[] = []) {
  const packet = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
  const picks = STAGES.map((stage) => ({
    stage,
    ideaId: refuse.includes(stage) ? null : (packet.value.ideas.find((entry: { stage: string }) => entry.stage === stage).id as string),
    reason: WHY,
  }));
  return { packet, reply: await callTool(studio, "critic_select", { ...rules, batchId, ticket: packet.value.ticket, picks }) };
}

/** The owner's yes. The words are his: they need not be the idea's own. */
const approve = (ideas: { id: string }[], words: { headline?: string; subline?: string } = {}) =>
  callTool(studio, "copy_approve", { ...rules, batchId, ideas: ideas.map((entry) => ({ ideaId: entry.id, headline: words.headline ?? "ONCE YOU START.", subline: words.subline ?? "You cannot stop.", ownerSaid: "yes, these words" })) });

async function render(ideaId: string, kind: "draft" | "final", fromId?: string): Promise<string> {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, ...(fromId ? { fromId } : {}) });
  if (!sent.ok) throw new Error(sent.error);
  return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
}
async function skeleton(ideaId: string): Promise<string> {
  const job = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId, bg: "101010" });
  return (await callTool(studio, "pixel_status", { batchId, jobId: job.value.id })).value.image.id;
}
async function checked(imageId: string) {
  await callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
  const job = await callTool(studio, "pack_check", { batchId, imageId, at: [500, 800], bg: "101010" });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
}
async function typeSet(imageId: string, extra: object = {}, look = true) {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const job = await callTool(studio, "type_set", { ...rules, batchId, imageId, area: [0.06, 0.12, 0.94, 0.3], colour: "FFFFFF", ...extra });
  if (!job.ok) return job;
  const set = await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
  // The agent looks at the picture with its words, as it does at the bare one.
  if (set.ok && look) await callTool(studio, "checks_save", { ...rules, batchId, imageId: set.value.image.id, items: [] });
  return set;
}
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state as string;
const selected = async () => (await callTool(studio, "batch_get", { batchId })).value.ideas as { id: string; stage: string; headline: string }[];

/** A v2 batch with its three ideas chosen and its words approved. */
async function wordedBatch(photos?: Parameters<typeof v2Batch>[0]) {
  await v2Batch(photos);
  await readTaste(studio, batchId);
  await callTool(studio, "references_get", { batchId });
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
  await choose();
  const ideas = await selected();
  await approve(ideas);
  await callTool(studio, "font_save", { brandId, family: "Archivo", weight: 800 });
  return ideas;
}

beforeEach(async () => {
  studio = await createStudio({ net: net() });
  await approvedClient(studio);
});

describe("a v2 batch: the burst", () => {
  it("needs the owner's reference ads read, beside his taste", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    const early = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/Not read yet: references_get/) });
    expect((await callTool(studio, "references_get", { batchId })).value).toMatchObject({ kind: "v2", references: [] });
    const ok = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    // The next step names the choice of an ad with words, not the keep-or-cut of a v1 batch.
    expect(ok.value.nextStep).toMatch(/critic_select/);
    expect(ok.ok ? "" : ok.error).toBe("");
  });

  it("refuses a burst of fewer than 24, and one with fewer than 8 for a stage", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    const few = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst().slice(0, 12) });
    expect(few).toMatchObject({ ok: false, error: expect.stringMatching(/24/) });
    const lopsided = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst((n) => (n % 3 === 2 ? { stage: "tof" } : {})) });
    expect(lopsided).toMatchObject({ ok: false, error: expect.stringMatching(/0 ideas for bottom of funnel/) });
  });

  it("refuses an idea that shows a thing the product has no real photo of", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    const reply = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst((n) => (n === 4 ? { shows: ["pack-1", "food-1"] } : {})) });
    expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/shows food-1, and this product has no such photo/) });
  });

  it("refuses a top of funnel headline with a price, and a number no fact proves", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    const priced = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst((n) => (n === 3 ? { stage: "tof", headline: "Now S$30 for six" } : {})) });
    expect(priced.ok).toBe(false);
    const unproven = await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst((n) => (n === 2 ? { subline: "40% less irritation after 28 days." } : {})) });
    expect(unproven).toMatchObject({ ok: false, error: expect.stringMatching(/40/) });
  });

  it("keeps the whole burst, and the fresh critic chooses one idea for each stage", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    const { packet, reply } = await choose();
    expect(packet.value.ideas).toHaveLength(24);
    // The critic gets the burst in another order than the author wrote it.
    expect(packet.value.ideas.map((entry: { id: string }) => entry.id)).not.toEqual(burst().map((_, index) => `idea-${index + 1}`));
    expect(reply.ok).toBe(true);
    const ideas = await selected();
    expect(ideas.map((entry) => entry.stage).sort()).toEqual(["bof", "mof", "tof"]);
    expect(await state()).toBe("judged");
    expect(await studio.services.batches.burst(batchId)).toHaveLength(24);
  });

  it("stays at its ideas when the critic refuses a stage", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    const { reply } = await choose(["mof"]);
    expect(reply.value.nextStep).toMatch(/refused stages/);
    expect(await state()).toBe("ideas");
    // The older tool of v1 cannot stand in for the choice.
    const packet = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
    const old = await callTool(studio, "critic_pick", { ...rules, batchId, ticket: packet.value.ticket, ideas: [] });
    expect(old.ok).toBe(false);
  });
});

describe("a v2 outreach batch: the burst", () => {
  const outreachBurst = async () => {
    await loadProspects(studio);
    await v2Batch([PACK], { prospectId: "00001" });
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
  };

  it("goes on with the one stage the critic chose: it makes one ad", async () => {
    await outreachBurst();
    const { reply } = await choose(["tof", "bof"]);
    expect(reply.value).toMatchObject({ state: "judged", refused: [{ stage: "tof" }, { stage: "bof" }], nextStep: expect.stringMatching(/starts no other critic/) });
    expect(reply.value.chosen).toHaveLength(1);
    expect((await studio.services.batches.ideas(batchId)).map((entry) => entry.stage)).toEqual(["mof"]);
  });

  it("sets other words on a draft when the owner asks, and shows the drafts again only with them", async () => {
    await outreachBurst();
    await choose();
    const ideas = await selected();
    await approve(ideas);
    await callTool(studio, "font_save", { brandId, family: "Archivo", weight: 800 });
    const drafts: Record<string, string[]> = {};
    for (const entry of ideas) {
      drafts[entry.id] = [];
      for (let n = 0; n < 3; n++) {
        const imageId = await render(entry.id, "draft", await skeleton(entry.id));
        await checked(imageId);
        await typeSet(imageId);
        drafts[entry.id]!.push(imageId);
      }
    }
    const picks = studio.services.outreach.picks;
    const view = async () => {
      const [files, optOuts] = await Promise.all([studio.services.outreach.store.all(), studio.services.outreach.store.optOuts()]);
      return picks.view(files.find((file) => file.profile.id === "00001")!, optOuts);
    };
    // No critic ranks the drafts of an outreach batch: the owner sees all nine.
    expect((await callTool(studio, "outreach_show", { batchId })).value).toMatchObject({ drafts: 9, canBePicked: 9, already: false });
    expect(await view()).toMatchObject({ words: true, waits: true, choosing: "open" });
    expect((await view())!.drafts[0]).toMatchObject({ headline: "ONCE YOU START.", subline: "You cannot stop." });

    const [first, second] = [ideas[0]!.id, ideas[1]!.id];
    const asked = drafts[first]![1]!;
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await picks.words("00001", asked, "Say that it is baked, not fried.");
    expect(await view()).toMatchObject({ waits: false, agentOwes: true, choosing: "agent", wordsAsked: { imageId: asked, ownerSaid: "Say that it is baked, not fried." } });
    expect((await callTool(studio, "outreach_next", {})).value.owed).toMatchObject([{ id: "00001", batchId, owes: "words", ideaId: first, imageId: asked, ownerSaid: "Say that it is baked, not fried." }]);

    // The drafts do not go back to him with the words he turned down, nor with new words that are not on the picture.
    const same = await callTool(studio, "outreach_show", { batchId });
    expect(same).toMatchObject({ ok: false, error: expect.stringMatching(/asked for other words on draft .*"Say that it is baked, not fried\."/) });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    expect((await approve([ideas[0]!], { headline: "BAKED, NOT FRIED." })).value.nextStep).toMatch(/outreach_show: no critic ranks them/);
    expect(await callTool(studio, "outreach_show", { batchId })).toMatchObject({ ok: false, error: expect.stringMatching(/type_set/) });
    const bare = (await view())!.drafts.filter((draft) => draft.ideaId === first);
    expect(bare.map((draft) => draft.blocked)).toEqual(Array(3).fill("Its words are not set yet."));

    for (const imageId of drafts[first]!) await typeSet(imageId);
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    expect((await callTool(studio, "outreach_show", { batchId })).value).toMatchObject({ drafts: 9, canBePicked: 9, already: false });
    const shown = (await view())!;
    expect(shown).toMatchObject({ waits: true, agentOwes: false, choosing: "open" });
    expect(shown.wordsAsked).toBeUndefined();
    expect(shown.drafts.find((draft) => draft.imageId === asked)).toMatchObject({ headline: "BAKED, NOT FRIED." });
    expect(shown.drafts.find((draft) => draft.ideaId === second)).toMatchObject({ headline: "ONCE YOU START." });
    expect((await callTool(studio, "outreach_next", {})).value.owed).toEqual([]);

    // He picks it, and the final carries the same words.
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await picks.pick("00001", asked, "owner@studio.example");
    expect((await callTool(studio, "outreach_next", {})).value.owed).toMatchObject([{ owes: "final", ideaId: first, imageId: asked }]);
    // Once a final is asked for, the words stay: none can be asked.
    const final = await render(first, "final", asked);
    expect(final).toBeTruthy();
    expect(await view()).toMatchObject({ words: false });
  });

  it("sets the words on a draft that only the pack measure faults: the owner may pick it, with a warning", async () => {
    await outreachBurst();
    await choose();
    const ideas = await selected();
    await approve(ideas);
    await callTool(studio, "font_save", { brandId, family: "Archivo", weight: 800 });
    const made: string[] = [];
    for (const entry of ideas) {
      for (let n = 0; n < 3; n++) {
        const imageId = await render(entry.id, "draft", await skeleton(entry.id));
        await checked(imageId);
        made.push(imageId);
      }
    }
    const [wide, ...rest] = made as [string, ...string[]];
    await studio.services.checks.measure(batchId, wide, "pack_check", { code: "D11", note: "render H/W 0.955 (486 x 509 px); packshot H/W 1.000; difference -4.5%; FAIL at 2%" });
    for (const imageId of rest) await typeSet(imageId);
    // The measure rejects nothing here, so this draft is an ad like the others: it waits for its words.
    expect(await callTool(studio, "outreach_show", { batchId })).toMatchObject({ ok: false, error: expect.stringMatching(/shown when each one is made, checked and carries its words/) });
    await typeSet(wide);
    expect((await callTool(studio, "outreach_show", { batchId })).value).toMatchObject({ drafts: 9, canBePicked: 9 });
    const [files, optOuts] = await Promise.all([studio.services.outreach.store.all(), studio.services.outreach.store.optOuts()]);
    const view = await studio.services.outreach.picks.view(files.find((file) => file.profile.id === "00001")!, optOuts);
    const warned = view!.drafts.filter((draft) => draft.warning);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ imageId: wide, warning: "The pack is drawn 5% wider than in its photo. The limit is 2%." });
    expect(warned[0]!.blocked).toBeUndefined();
  });

  it("blocks no draft for what the agent saw on its words, and carries that note to the attached ad", async () => {
    await outreachBurst();
    await choose();
    const ideas = await selected();
    await approve(ideas);
    await callTool(studio, "font_save", { brandId, family: "Archivo", weight: 800 });
    const made: string[] = [];
    for (const entry of ideas) {
      for (let n = 0; n < 3; n++) {
        const imageId = await render(entry.id, "draft", await skeleton(entry.id));
        await checked(imageId);
        made.push(imageId);
      }
    }
    const [over, ...rest] = made as [string, ...string[]];
    for (const imageId of rest) await typeSet(imageId);
    const look = (imageId: string, items: object[]) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
    // The agent sees a D item on the draft with its words: in a client's batch that sends the type back, here it is a note.
    const set = await typeSet(over, { area: [0.05, 0.19, 0.55, 0.75], colour: "EEEEEE", logoWidth: 0.12, logoX: 0.05, minHead: 0.03, weight: 900 }, false);
    const seen = await look(set.value.image.id, [{ code: "D1", note: "The headline runs over the pack." }]);
    expect(seen.value).toMatchObject({ state: "checked", note: expect.stringMatching(/a check rejects nothing/) });
    expect((await callTool(studio, "outreach_show", { batchId })).value).toMatchObject({ drafts: 9, canBePicked: 9 });
    const picks = studio.services.outreach.picks;
    const [files, optOuts] = await Promise.all([studio.services.outreach.store.all(), studio.services.outreach.store.optOuts()]);
    const draft = (await picks.view(files.find((file) => file.profile.id === "00001")!, optOuts))!.drafts.find((entry) => entry.imageId === over)!;
    expect(draft.blocked).toBeUndefined();
    expect(draft.warning).toBe("The agent saw: The headline runs over the pack.");

    // He picks it. What the agent sees on the final with its words goes with the ad, beside what it saw on the bare final.
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await picks.pick("00001", over, "owner@studio.example");
    const final = await render(ideas[0]!.id, "final", over);
    await checked(final);
    await look(final, [{ code: "F2", note: "The shadow under the pack is hard." }]);
    const finish = await callTool(studio, "photo_finish", { ...rules, batchId, imageId: final });
    await callTool(studio, "pixel_status", { batchId, jobId: finish.value.id });
    // Found live (23-11-2026): the agent set the final's words anew, dark at the bottom under a large centred logo, where the
    // picked draft had them light at the top left under a small logo. The final takes the picked draft's place, size and colour.
    const bare = await callTool(studio, "type_set", { ...rules, batchId, imageId: final });
    expect(bare.ok ? "" : bare.error).toBe("");
    expect(bare.value.next).toMatch(/as on the draft the owner picked/);
    await callTool(studio, "pixel_status", { batchId, jobId: bare.value.id });
    // A font the studio does not hold is no stop either: the final asks for none.
    const worded = await typeSet(final, { area: [0.05, 0.8, 0.66, 0.96], colour: "282828", logoWidth: 0.25, logo: false, weight: 700, family: "Nowhere Sans", subFamily: "Nowhere Serif" }, false);
    expect(worded.ok ? "" : worded.error).toBe("");
    const [onDraft, onBare, onFinal] = studio.pixels.events.filter((event) => event.tool === "headline").slice(-3).map((event) => event.input);
    const how = ({ renderKey: _renderKey, ...rest }: Record<string, unknown>) => rest;
    expect(onDraft).toMatchObject({ area: [0.05, 0.19, 0.55, 0.75], colour: "EEEEEE", logoWidth: 0.12, logoX: 0.05, weight: 900 });
    expect(how(onBare!)).toEqual(how(onDraft!));
    expect(how(onFinal!)).toEqual(how(onDraft!));
    expect(onFinal!.renderKey).not.toBe(onDraft!.renderKey);
    await look(worded.value.image.id, [{ code: "D1", note: "The headline runs over the pack." }]);
    expect((await callTool(studio, "batch_done", { batchId })).value).toMatchObject({ done: true });
    const attached = (await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its rock." })).value;
    expect(attached.ad).toMatchObject({ picked: true, warning: "The agent saw: The shadow under the pack is hard. The agent saw: The headline runs over the pack." });
  });

  it("is judged twice at most when the critic refuses every stage", async () => {
    await outreachBurst();
    expect((await choose([...STAGES])).reply.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/round 1 of 2/) });
    expect((await choose([...STAGES])).reply.value).toMatchObject({ state: "ideas", nextStep: expect.stringMatching(/round 2 of 2, the last/) });
    const third = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
    expect(third).toMatchObject({ ok: false, error: expect.stringMatching(/judged 2 times.*Park it/) });
  });
});

describe("a v2 batch: the words", () => {
  it("makes no draft before the owner approves the words", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    await choose();
    const [first] = await selected();
    const made = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: first!.id, bg: "101010" });
    const fromId = made.ok ? (await callTool(studio, "pixel_status", { batchId, jobId: made.value.id })).value.image.id : undefined;
    const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId: first!.id, kind: "draft", prompt: SCENE, ...(fromId ? { fromId } : {}) });
    expect(sent.ok ? "sent" : sent.error).toMatch(/copy_approve/);
    expect(studio.fal.submits()).toHaveLength(0);
  });

  it("takes the words from the owner only, all three ideas at first, exactly as he gave them", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    await choose();
    const ideas = await selected();
    const member = await callTool(studio, "copy_approve", { ...rules, batchId, ideas: [{ ideaId: ideas[0]!.id, headline: "A", subline: "B", ownerSaid: "yes" }] }, { sub: "sub-member" });
    expect(member.ok).toBe(false);
    expect(await approve(ideas.slice(0, 2))).toMatchObject({ ok: false, error: expect.stringMatching(/covers every idea/) });
    const saved = await approve(ideas, { headline: "Why your favorite café | switched to OATSIDE." });
    expect(saved.value).toMatchObject({ state: "worded", approved: [{ headline: "Why your favorite café | switched to OATSIDE.", version: 1 }, { version: 1 }, { version: 1 }] });
    // The same words again keep their version; other words are a new one.
    const again = await approve([ideas[0]!], { headline: "Why your favorite café | switched to OATSIDE." });
    expect(again.value.approved[0]).toMatchObject({ version: 1 });
    const changed = await approve([ideas[0]!], { headline: "Last one already?" });
    expect(changed.value.approved[0]).toMatchObject({ version: 2, headline: "Last one already?" });
  });

  it("refuses words with a number that the idea's facts do not hold", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    await choose();
    const ideas = await selected();
    const reply = await approve(ideas, { subline: "1.6x faster skin recovery in 2 weeks." });
    expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/are not saved/) });
    expect(await state()).toBe("judged");
  });
});

describe("a v2 batch: the type", () => {
  it("saves a brand font from Google Fonts, and refuses a file that is not a font", async () => {
    await v2Batch();
    const first = (await studio.services.brands.brand(brandId)).createdAt;
    studio.clock.now = new Date(studio.clock.now.getTime() + 60_000);
    const saved = await callTool(studio, "font_save", { brandId, family: "Archivo", weight: 800 });
    // A brand that is saved again keeps the day it was first saved.
    expect((await studio.services.brands.brand(brandId)).createdAt).toBe(first);
    expect(saved.value).toMatchObject({ saved: { family: "Archivo", weight: 800, sourceUrl: FONT_FILE }, fontFiles: [{ family: "Archivo", weight: 800 }] });
    expect(studio.pictures.files.get(`brands/${brandId}/fonts/archivo-800.ttf`)?.type).toBe("font/ttf");
    const missing = await callTool(studio, "font_save", { brandId, family: "Brand Sans", weight: 700 });
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/not on Google Fonts/) });

    studio = await createStudio({ net: fakeNet({ "https://wongi.example/fonts/brand.woff2": { body: "<html>not a font</html>" } }) });
    await approvedClient(studio);
    await v2Batch();
    const html = await callTool(studio, "font_save", { brandId, family: "Brand Sans", weight: 700, url: "https://wongi.example/fonts/brand.woff2" });
    expect(html).toMatchObject({ ok: false, error: expect.stringMatching(/not a TrueType, OpenType, WOFF or WOFF2 font/) });
    const local = await callTool(studio, "font_save", { brandId, family: "Brand Sans", weight: 700, url: "https://169.254.169.254/latest/meta-data" });
    expect(local.ok).toBe(false);
  });

  it("sets the owner's words, never the caller's, in the brand's font with the real logo", async () => {
    const ideas = await wordedBatch();
    const draft = await render(ideas[0]!.id, "draft", await skeleton(ideas[0]!.id));
    const smuggled = await callTool(studio, "type_set", { ...rules, batchId, imageId: draft, area: [0.06, 0.12, 0.94, 0.3], headline: "FREE TODAY" });
    expect(smuggled.ok).toBe(false);
    const set = await typeSet(draft);
    expect(set.value).toMatchObject({ status: "done", image: { kind: "typeset", fromId: draft, rootId: draft, ideaId: ideas[0]!.id } });
    const event = studio.pixels.events.find((entry) => entry.tool === "headline");
    expect(event?.input).toMatchObject({ headline: "ONCE YOU START.", subline: "You cannot stop.", fontKey: `brands/${brandId}/fonts/archivo-800.ttf`, logoKey: "brands/b/logo.png", colour: "FFFFFF" });
    expect(event?.outKey).toMatch(new RegExp(`^batches/${batchId}/`));
  });

  it("sets the subline in the brand's second face when the brand has one", async () => {
    // Found live (22-11-2026): a brand with a display face for its headline and another face for its small words.
    const ideas = await wordedBatch();
    const second = await callTool(studio, "font_save", { brandId, family: "Inter", weight: 500 });
    expect(second.ok ? "" : second.error).toBe("");
    const draft = await render(ideas[0]!.id, "draft", await skeleton(ideas[0]!.id));
    const set = await typeSet(draft, { subFamily: "Inter", subWeight: 500 });
    expect(set.ok ? "" : set.error).toBe("");
    expect(studio.pixels.events.findLast((entry) => entry.tool === "headline")?.input).toMatchObject({
      fontKey: `brands/${brandId}/fonts/archivo-800.ttf`,
      subFontKey: `brands/${brandId}/fonts/inter-500.ttf`,
      // The weights go to the tool too: a variable font takes them on its weight axis.
      weight: 800,
      subWeight: 500,
    });
    expect(await typeSet(draft, { subFamily: "Papyrus" })).toMatchObject({ ok: false, error: expect.stringMatching(/no font file of "Papyrus".*font_save/) });
  });

  it("refuses to set words without a saved font file, on a v1 batch, and on an idea without approved words", async () => {
    await v2Batch();
    await readTaste(studio, batchId);
    await callTool(studio, "references_get", { batchId });
    await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
    await choose();
    const ideas = await selected();
    await approve(ideas);
    const draft = await render(ideas[0]!.id, "draft", await skeleton(ideas[0]!.id));
    expect(await typeSet(draft)).toMatchObject({ ok: false, error: expect.stringMatching(/font_save/) });
    expect(studio.pixels.events.some((entry) => entry.tool === "headline")).toBe(false);
  });

  it("builds a skeleton from a real photo of each thing by its name, never from a file an agent typed", async () => {
    const ideas = await wordedBatch([PACK, SLICE, SLICE]);
    const plan = { bg: "FFD21E", products: [{ cx: 0.3, base: 0.8, height: 0.3 }, { cx: 0.7, base: 0.8, height: 0.2, photo: "food-2" }] };
    const made = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: ideas[0]!.id, plan, vary: { regions: [[80, 200, 300, 420]] } });
    expect(made.ok ? "" : made.error).toBe("");
    const { input } = studio.pixels.events.at(-1)!;
    expect(input).toMatchObject({ vary: { regions: [[80, 200, 300, 420]], seed: 7 }, plan: { products: [{ cx: 0.3 }, { cx: 0.7, photoKey: "products/p/slice.jpg" }] } });
    expect(JSON.stringify(input)).not.toMatch(/"photo":/);
    const missing = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: ideas[0]!.id, plan: { ...plan, products: [{ cx: 0.5, base: 0.8, height: 0.3, photo: "prop-1" }] } });
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: this product has no photo prop-1/) });
  });

  it("does not count words that were sent before the owner changed them, though the picture came after", async () => {
    const ideas = await wordedBatch();
    const draft = await render(ideas[0]!.id, "draft", await skeleton(ideas[0]!.id));
    // The job is sent with the first words, and read only after the owner changed them.
    const job = await callTool(studio, "type_set", { ...rules, batchId, imageId: draft, area: [0.06, 0.12, 0.94, 0.3], colour: "FFFFFF" });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await approve([ideas[0]!], { headline: "THE ONE THAT STARTED IT ALL." });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const old = await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
    expect(old.value.image).toMatchObject({ kind: "typeset", wordsVersion: 1 });
    const shown = async () => (await studio.services.board.board(batchId)).ideas.find((entry) => entry.idea.id === ideas[0]!.id)!.drafts[0]!.words;
    expect(await shown()).toBeUndefined();

    expect((await typeSet(draft)).value.image).toMatchObject({ wordsVersion: 2 });
    expect((await shown())?.image.wordsVersion).toBe(2);
  });

  it("does not show the owner a draft without its words, and asks for them again after a change", async () => {
    const ideas = await wordedBatch();
    const drafts: Record<string, string[]> = {};
    for (const entry of ideas) {
      drafts[entry.id] = [];
      for (let n = 0; n < 3; n++) {
        const imageId = await render(entry.id, "draft", await skeleton(entry.id));
        await checked(imageId);
        drafts[entry.id]!.push(imageId);
      }
    }
    const bare = await callTool(studio, "board_show", { batchId });
    expect(JSON.stringify(bare)).toMatch(/type_set for picture/);
    expect(await state()).toBe("drafting");

    // A rank of the bare photos is not a rank of the ads: it does not count once the words are on.
    expect((await rankDrafts(studio, batchId)).ok).toBe(true);
    const sets: Record<string, string> = {};
    for (const list of Object.values(drafts)) for (const imageId of list) sets[imageId] = (await typeSet(imageId, {}, false)).value.image.id;
    // The picture with its words is what the owner sees: it is looked at too, and its faults are saved on it.
    const unseen = await callTool(studio, "board_show", { batchId });
    const one = Object.keys(sets)[0]!;
    expect(JSON.stringify(unseen)).toContain(`checks_save for picture ${sets[one]}`);
    const fault = await callTool(studio, "checks_save", { ...rules, batchId, imageId: sets[one], items: [{ code: "D1", note: "The headline runs over the pack." }] });
    expect(fault.value.stillMissing).toContain(`type_set again for picture ${one}: with its words it has D1 (The headline runs over the pack.)`);
    sets[one] = (await typeSet(one)).value.image.id;
    for (const imageId of Object.values(sets)) await callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
    const stale = await callTool(studio, "board_show", { batchId });
    expect(stale).toMatchObject({ ok: false, error: expect.stringMatching(/blind critic's rank of the drafts of .* as they are now/) });

    const packet = await callTool(studio, "critic_open", { batchId, step: "drafts", freshHelper: true });
    // The critic's rank is of the picture it opened: the one with the words.
    expect(packet.value.ideas.flatMap((entry: { drafts: { imageId: string; shownId: string }[] }) => entry.drafts.map((draft) => [draft.imageId, draft.shownId])).sort()).toEqual(Object.entries(sets).sort());
    expect((await rankDrafts(studio, batchId)).ok).toBe(true);
    const board = await callTool(studio, "board_show", { batchId });
    expect(board.value.batch.state).toBe("waiting_pick");
    expect(board.value.ideas[0].copy).toMatchObject({ headline: "ONCE YOU START." });
    expect(board.value.ideas[0].drafts[0].words.image.kind).toBe("typeset");

    // The owner changes the words of one idea: its pictures carry the old words, so they no longer count.
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    await approve([ideas[0]!], { headline: "THE ONE THAT STARTED IT ALL." });
    const after = await callTool(studio, "board_show", { batchId });
    const first = after.value.ideas.find((entry: { idea: { id: string } }) => entry.idea.id === ideas[0]!.id);
    expect(first.drafts.every((draft: { words?: unknown }) => draft.words === undefined)).toBe(true);
    // He has not seen the ad with his new words, so he cannot choose among its drafts yet, nor pass on them.
    const early = await callTool(studio, "pick_save", { batchId, ideaId: ideas[0]!.id, imageId: drafts[ideas[0]!.id]![0], ownerSaid: "this one" });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/words of .* are not on its drafts as they are now.*type_set.*fresh critic rank them again/) });
    expect(await callTool(studio, "pick_save", { batchId, ideaId: ideas[0]!.id, imageId: null, ownerSaid: "none" })).toMatchObject({ ok: false });
    // An idea whose words did not change is still his to choose.
    const other = await callTool(studio, "pick_save", { batchId, ideaId: ideas[1]!.id, imageId: drafts[ideas[1]!.id]![0], ownerSaid: "this one" });
    expect(other.value.pick).toMatchObject({ imageId: drafts[ideas[1]!.id]![0], shownId: sets[drafts[ideas[1]!.id]![0]!] });

    const again: string[] = [];
    for (const imageId of drafts[ideas[0]!.id]!) again.push((await typeSet(imageId)).value.image.id);
    const picked = await callTool(studio, "pick_save", { batchId, ideaId: ideas[0]!.id, imageId: drafts[ideas[0]!.id]![0], ownerSaid: "this one" });
    expect(picked.value.pick).toMatchObject({ shownId: again[0] });
  });
});
