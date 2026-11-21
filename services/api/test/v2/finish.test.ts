import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { idea, rankDrafts, readTaste, sheet } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, json, type Studio } from "../helpers/deps.js";
import { fakeNet } from "../helpers/net.js";
import { PNG } from "../helpers/pictures.js";

const rules = { rulesVersion: RULES_VERSION };
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it. The top third is plain dark sky.";
const STAGES = ["tof", "mof", "bof"] as const;
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
const FONT_FILE = "https://fonts.gstatic.com/s/archivo/v19/archivo-800.ttf";
const REFERENCE = "https://cdn.example/ads/once-you-start.png";
const PHOTOS = [
  { key: "products/p/pack.jpg", sourceUrl: "https://cdn.wongi.example/pack.jpg", kind: "pack" as const },
  { key: "products/p/food.jpg", sourceUrl: "https://cdn.wongi.example/food.jpg", kind: "food" as const },
  { key: "products/p/slice.jpg", sourceUrl: "https://cdn.wongi.example/slice.jpg", kind: "food" as const, what: "A slice of the second flavour" },
];

let studio: Studio;
let batchId: string;
let ideas: { id: string }[];
let drafts: Record<string, string>;

const tick = () => (studio.clock.now = new Date(studio.clock.now.getTime() + 1000));
const letter = (n: number) => String.fromCharCode(64 + n);
const burst = () => Array.from({ length: 24 }, (_, index) => idea(index + 1, { stage: STAGES[(index + 1) % 3], headline: `Headline ${letter(index + 1)}`, subline: "Still the original.", claims: [], shows: ["pack-1"] }));

/** Runs a pixel tool to its end. */
async function run(tool: string, args: object) {
  tick();
  const sent = await callTool(studio, tool, { ...rules, batchId, ...args });
  if (!sent.ok) return sent;
  return callTool(studio, "pixel_status", { batchId, jobId: sent.value.id });
}
async function render(ideaId: string, kind: "draft" | "final", fromId: string): Promise<string> {
  tick();
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, fromId });
  if (!sent.ok) throw new Error(sent.error);
  return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
}
async function checked(imageId: string) {
  await callTool(studio, "checks_save", { ...rules, batchId, imageId, items: [] });
  const job = await callTool(studio, "pack_check", { batchId, imageId, at: [500, 800], bg: "101010" });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
}
/** Sets the approved words on a picture and, as the agent must, looks at the picture with them. */
async function words(imageId: string, look = true) {
  const set = await run("type_set", { imageId, area: [0.06, 0.12, 0.94, 0.3], colour: "FFFFFF" });
  if (set.ok && look) await callTool(studio, "checks_save", { ...rules, batchId, imageId: set.value.image.id, items: [] });
  return set;
}
const done = async () => (await callTool(studio, "batch_done", { batchId })).value;

/** A v2 batch with nine checked drafts that carry the approved words, ranked and shown. */
beforeEach(async () => {
  studio = await createStudio({
    net: fakeNet({
      "https://fonts.googleapis.com/css2?family=Archivo:wght@800": { body: `@font-face { src: url(${FONT_FILE}) format('truetype'); }` },
      [FONT_FILE]: { body: TTF },
      [REFERENCE]: { body: PNG },
    }),
  });
  await approvedClient(studio);
  const brand = await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: { key: "brands/b/logo.png", sourceUrl: "https://wongi.example/logo.png" }, palette: [], fonts: ["Archivo"], savedBy: "owner@example.com" });
  const product = await studio.services.brands.saveProduct({ brandId: brand.id, name: "Seaweed crisps", url: "https://wongi.example/products/seaweed-crisps", photos: PHOTOS, savedBy: "owner@example.com" });
  batchId = (await callTool(studio, "batch_create", { kind: "v2", brandId: brand.id, productId: product.id })).value.batch.id;
  await callTool(studio, "truth_save", { batchId, ...sheet });
  await readTaste(studio, batchId);
  await callTool(studio, "references_get", { batchId });
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: burst() });
  const packet = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
  const picks = STAGES.map((stage) => ({ stage, ideaId: packet.value.ideas.find((entry: { stage: string }) => entry.stage === stage).id as string, reason: "It reads at once." }));
  await callTool(studio, "critic_select", { ...rules, batchId, ticket: packet.value.ticket, picks });
  ideas = (await callTool(studio, "batch_get", { batchId })).value.ideas;
  await callTool(studio, "copy_approve", { ...rules, batchId, ideas: ideas.map(({ id }) => ({ ideaId: id, headline: "THE ONE THAT | STARTED IT ALL.", subline: "Still good, still original.", ownerSaid: "yes" })) });
  await callTool(studio, "font_save", { brandId: brand.id, family: "Archivo", weight: 800 });
  drafts = {};
  for (const { id } of ideas) {
    for (let n = 0; n < 3; n++) {
      const skeleton = await run("skeleton_make", { ideaId: id, plan: { bg: "101010", products: [{ cx: 0.5, base: 0.85, height: 0.4 }] } });
      const imageId = await render(id, "draft", skeleton.value.image.id);
      await checked(imageId);
      await words(imageId);
      drafts[id] ??= imageId;
    }
  }
  await rankDrafts(studio, batchId);
  await callTool(studio, "board_show", { batchId });
});

async function final(ideaId: string) {
  await callTool(studio, "pick_save", { batchId, ideaId, imageId: drafts[ideaId], ownerSaid: "this one" });
  const imageId = await render(ideaId, "final", drafts[ideaId]!);
  await checked(imageId);
  return imageId;
}

describe("a v2 batch: finals", () => {
  it("is finished only when each final has its finish and then its words", async () => {
    const finals: string[] = [];
    for (const { id } of ideas) finals.push(await final(id));
    // The words go on the finished picture, so a final without its finish takes none.
    expect(await words(finals[0]!)).toMatchObject({ ok: false, error: expect.stringMatching(/photo_finish/) });
    for (const imageId of finals) await run("photo_finish", { imageId });
    let report = await done();
    expect(report).toMatchObject({ done: false, batch: { state: "finals" } });
    expect(JSON.stringify(report.conditions)).toMatch(/type_set for picture/);

    for (const imageId of finals) {
      const set = await words(imageId, false);
      expect(set.value.image).toMatchObject({ kind: "typeset", rootId: imageId });
      // The picture with its words is what is delivered: it is looked at too, and a D item on it sends the type back.
      expect(JSON.stringify((await done()).conditions)).toContain(`checks_save for picture ${set.value.image.id}`);
      const bad = await callTool(studio, "checks_save", { ...rules, batchId, imageId: set.value.image.id, items: [{ code: "D1", note: "The headline runs over the pack." }] });
      expect(bad.value.stillMissing).toContain(`type_set again for picture ${imageId}: with its words it has D1 (The headline runs over the pack.)`);
      await words(imageId);
    }
    // The type goes on the finished picture, not under the grain.
    const last = studio.pixels.events.filter((event) => event.tool === "headline").at(-1)!;
    expect(last.input.renderKey).toMatch(/finish/);
    report = await done();
    expect(report).toMatchObject({ done: true, batch: { state: "done" } });
    expect(report.conditions.map((entry: { name: string }) => entry.name)).toEqual(["picks", "finals", "words"]);
    expect(report.conditions[2]).toMatchObject({ passed: true, evidence: expect.stringMatching(/THE ONE THAT \| STARTED IT ALL\./) });
    const board = (await callTool(studio, "board_show", { batchId })).value;
    expect(board.ideas[0].finals[0].words.image.kind).toBe("typeset");

    // The done batch becomes a client pack: the pictures with their words, under names the studio made.
    const text = { primary: "The one that started it all. We still make it the first way. Order yours today.", headline: "Still the original", description: "Order the seaweed crisps", cta: "Order Now" };
    const why = ideas.map(({ id }) => ({ ideaId: id, why: "Buyers ask for the first flavour by name; the ad says it is still here." }));
    const publish = { ...rules, batchId, why, launchPlan: ["Put all three ads in one ad set.", "Run them for 72 hours."] };
    expect(await callTool(studio, "pack_publish", publish)).toMatchObject({ ok: false, error: expect.stringMatching(/has not approved the Meta text/) });
    await callTool(studio, "meta_save", { ...rules, batchId, ads: ideas.map(({ id }) => ({ ideaId: id, variants: [text, { ...text, headline: "The first one" }] })) });
    await callTool(studio, "meta_approve", { ...rules, batchId, ads: ideas.map(({ id }) => ({ ideaId: id, version: 1, ownerSaid: "yes" })) });
    const pack = (await callTool(studio, "pack_publish", publish)).value;
    expect(pack.version.ads.map((ad: { adName: string }) => ad.adName).sort()).toEqual(["a11_W47_wongi_b01_bof_c", "a11_W47_wongi_b01_mof_c", "a11_W47_wongi_b01_tof_c"].map((name) => expect.stringMatching(new RegExp(`^${name}[123]_v1$`))));
    expect(pack.version.ads.map((ad: { imageId: string }) => ad.imageId).sort()).toEqual(board.ideas.map((entry: { finals: { words: { image: { id: string } } }[] }) => entry.finals[0]!.words.image.id).sort());
    const page = await studio.app.request(new URL(pack.link).pathname.replace("/c/", "/api/pack/"));
    expect(page.status).toBe(200);
    expect((await json(page)).ads).toHaveLength(3);
  });
});

describe("a v2 batch: repairs", () => {
  it("grades food toward the brand's own close-up, and the repair then needs its checks and its words again", async () => {
    const imageId = drafts[ideas[0]!.id]!;
    const made = await run("food_grade", { imageId, regions: [[300, 700, 700, 1000]], refBox: [10, 10, 200, 200], photo: 2 });
    expect(made.value.image).toMatchObject({ kind: "grade", fromId: imageId, rootId: imageId });
    expect(studio.pixels.events.at(-1)!.input).toMatchObject({ foodKey: "products/p/slice.jpg", refBox: [10, 10, 200, 200], strength: 0.8 });
    expect(await run("food_grade", { imageId, regions: [[300, 700, 700, 1000]], refBox: [10, 10, 200, 200], photo: 5 })).toMatchObject({ ok: false, error: expect.stringMatching(/2 food photo/) });
    const board = (await callTool(studio, "board_show", { batchId })).value;
    const draft = board.ideas.flatMap((entry: { drafts: { image: { id: string } }[] }) => entry.drafts).find((entry: { image: { id: string } }) => entry.image.id === imageId);
    expect(draft).toMatchObject({ shown: { kind: "grade" }, checks: null });
    expect(draft.words).toBeUndefined();
  });

  it("relights a pack and puts a box's print back, each as a repair of the picture", async () => {
    const imageId = drafts[ideas[1]!.id]!;
    const lit = await run("product_relight", { imageId, box: [400, 620, 500, 1100], light: "right", floor: [200, 190, 180] });
    expect(lit.value.image).toMatchObject({ kind: "relight", rootId: imageId });
    const printed = await run("box_print", { imageId: lit.value.image.id, face: [60, 90, 540, 640], blocks: [{ box: [100, 200, 400, 300] }] });
    expect(printed.value.image).toMatchObject({ kind: "box_print", fromId: lit.value.image.id, rootId: imageId });
    expect(studio.pixels.events.at(-1)!.input).toMatchObject({ packKey: "products/p/pack.jpg", face: [60, 90, 540, 640], blocks: [{ box: [100, 200, 400, 300] }] });
    // No agent names a file or a typeset block: both are refused at the door.
    expect((await run("box_print", { imageId, face: [60, 90, 540, 640], blocks: [{ box: [100, 200, 400, 300], typeset: { text: "NEW" } }] })).ok).toBe(false);
    expect((await run("food_grade", { imageId, regions: [[1, 1, 9, 9]], refBox: [1, 1, 9, 9], foodKey: "brands/other/food.jpg" })).ok).toBe(false);
  });
});

describe("the owner's reference ads", () => {
  it("are saved by the owner only, and read by the kind of the batch", async () => {
    const entry = { url: REFERENCE, kinds: ["v2", "v3"], brand: "IRVINS", title: "ONCE YOU START.", why: "The pack fills the frame; the words finish the thought the picture starts." };
    expect((await callTool(studio, "reference_add", entry, { sub: "sub-member" })).ok).toBe(false);
    const saved = await callTool(studio, "reference_add", entry);
    expect(saved.value).toMatchObject({ kinds: ["v2", "v3"], title: "ONCE YOU START." });
    expect(JSON.stringify(saved.value)).not.toMatch(/references\//);
    await callTool(studio, "reference_add", { ...entry, kinds: ["v1"], title: "Strawberry slice", loose: true });

    const read = (await callTool(studio, "references_get", { batchId })).value;
    expect(read.references).toHaveLength(1);
    expect(read.references[0]).toMatchObject({ title: "ONCE YOU START.", viewUrl: expect.stringMatching(/^https:\/\/pictures\.example\/references\/.+signed=1$/) });
    expect(read.references[0]).not.toHaveProperty("savedBy");
    expect(await callTool(studio, "reference_add", { ...entry, url: "https://10.0.0.8/ad.png" })).toMatchObject({ ok: false });
  });
});
