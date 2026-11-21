import { beforeEach, describe, expect, it } from "vitest";
import { RenderStore } from "../../src/render/store.js";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import type { FalCall } from "../helpers/fal.js";

const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";
const refused = (pattern: RegExp) => ({ ok: false, error: expect.stringMatching(pattern) });

let studio: Studio;
let batchId: string;

/** A batch with its three ideas saved. With `pack`, the product has a pack photo, so drafts need skeletons. */
async function batchAtIdeas(options: { fal?: (call: FalCall) => ReturnType<NonNullable<Parameters<typeof createStudio>[0]>["fal"] & object> | undefined; pack?: boolean } = {}) {
  studio = await createStudio(options.fal ? { fal: options.fal } : {});
  await approvedClient(studio);
  const made = await batchAtTruth(studio);
  batchId = made.batchId;
  if (options.pack) {
    await studio.services.brands.saveProduct({ ...made.product, photos: [...made.product.photos, { key: "products/p/pack.png", sourceUrl: "https://cdn.wongi.example/pack.png", kind: "pack" }] });
  }
  await callTool(studio, "ideas_save", { rulesVersion: RULES_VERSION, batchId, ideas: [idea(1), idea(2), idea(3)] });
  await judgeIdeas(studio, batchId);
}

const draft = (extra: object = {}) => callTool(studio, "render_submit", { rulesVersion: RULES_VERSION, batchId, ideaId: "idea-1", kind: "draft", prompt: SCENE, ...extra });
const skeleton = async (n: number) => (await studio.services.images.add({ batchId, kind: "skeleton", key: `batches/${batchId}/skeletons/s${n}.png` })).id;
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;

beforeEach(() => batchAtIdeas());

describe("render_submit", () => {
  it("covers AE3: refuses a prompt that asks for a headline, names R16, and sends nothing", async () => {
    expect(await draft({ prompt: `${SCENE} Put the headline across the top.` })).toEqual(refused(/R16.*no words.*"headline"/));
    expect(studio.fal.calls).toEqual([]);
    expect((await studio.spend.ledger.summary()).lines).toEqual([]);
  });

  it("sends a draft at low quality and 1024 by 1280, with the picture rules added and the key in the header only", async () => {
    const sent = await draft({ references: ["food-1"] });
    expect(sent.value).toMatchObject({ kind: "draft", status: "queued", usd: 0.019, note: expect.stringMatching(/goes alone/) });
    const [call] = studio.fal.submits();
    expect(call?.url).toBe("https://queue.fal.run/openai/gpt-image-2.5/sunburst/edit");
    expect(call?.body).toMatchObject({ image_size: { width: 1024, height: 1280 }, quality: "low", num_images: 1, image_urls: ["https://pictures.example/products/p/food.jpg?signed=1"] });
    expect(call?.body?.prompt).toMatch(/^The pouch stands[\s\S]*No words, letters or numbers anywhere in the picture/);
    expect(call?.key).toMatch(/^Key /);
    expect(JSON.stringify(call?.body)).not.toContain(call?.key?.slice(4));
    expect(JSON.stringify(sent.value)).not.toMatch(/queue\.fal\.run|reservation/);
    expect(await state()).toBe("judged");
  });

  it("refuses a second draft before the first draft's price is known, then sends the rest when it is under US$1", async () => {
    const first = await draft();
    expect(await draft({ ideaId: "idea-2" })).toEqual(refused(/first of the drafts is out to read the price/));
    expect(studio.fal.submits()).toHaveLength(1);

    const done = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(done.value).toMatchObject({ status: "done", image: { kind: "draft", ideaId: "idea-1", viewUrl: expect.stringContaining("signed=1") }, note: expect.stringMatching(/9 drafts come to about US\$0\.08, under US\$1/) });
    expect(studio.pictures.files.has(done.value.image.key)).toBe(true);
    expect(await state()).toBe("priced");

    expect((await draft({ ideaId: "idea-2" })).ok).toBe(true);
    expect(await state()).toBe("drafting");
    expect((await studio.spend.ledger.summary(batchId)).lines.map((line) => line.status).sort()).toEqual(["reserved", "spent"]);
  });

  it("waits for the owner's yes when the drafts come to US$1 or more", async () => {
    const first = await draft();
    await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    // A dearer price for each of the rest: with the first one and this one, the nine pass US$1.
    await studio.spend.gate.price(batchId, "drafts", { firstUsd: 0.15, count: 9 });

    expect(await draft({ ideaId: "idea-2" })).toEqual(refused(/waits for the owner's yes: 9 drafts at about US\$1\.\d+ in total/));
    expect(await state()).toBe("waiting_spend");
    expect(await callTool(studio, "spend_approve", { batchId, stage: "drafts" }, { sub: "sub-member" })).toEqual(refused(/Only the owner/));
    expect((await callTool(studio, "spend_approve", { batchId, stage: "drafts" })).ok).toBe(true);
    expect((await draft({ ideaId: "idea-2" })).ok).toBe(true);
    expect(await state()).toBe("drafting");
  });

  it("builds each draft of an idea round its own skeleton (R23, R29)", async () => {
    await batchAtIdeas({ pack: true });
    expect(await draft()).toEqual(refused(/R29.*skeleton_make/));
    const [one, two, three] = [await skeleton(1), await skeleton(2), await skeleton(3)];
    const first = await draft({ fromId: one });
    await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(studio.fal.submits()[0]?.body?.image_urls).toEqual([`https://pictures.example/batches/${batchId}/skeletons/s1.png?signed=1`]);

    expect(await draft({ fromId: one })).toEqual(refused(/R23.*its own skeleton/));
    expect((await draft({ fromId: two })).ok).toBe(true);
    expect((await draft({ fromId: three })).ok).toBe(true);
    expect(await draft({ fromId: await skeleton(4) })).toEqual(refused(/has its 3 drafts/));
    // Another idea may use a skeleton that a first idea used.
    expect((await draft({ ideaId: "idea-2", fromId: one })).ok).toBe(true);
  });

  it("takes only the product's photos and the brand's logo as other references", async () => {
    expect(await draft({ references: ["products/other/secret.jpg"] })).toMatchObject({ ok: false });
    expect(await draft({ references: ["food-2"] })).toEqual(refused(/no food photo 2/));
    // A prop is a real photo like the pack and the food: its name reaches the service.
    expect(await draft({ references: ["prop-1"] })).toEqual(refused(/no prop photo 1/));
    expect(await draft({ references: ["logo"] })).toEqual(refused(/brand has no logo/));
    expect(studio.fal.calls).toEqual([]);
  });

  it("refuses a final for a draft the owner did not pick", async () => {
    const first = await draft();
    const done = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    const final = await callTool(studio, "render_submit", { rulesVersion: RULES_VERSION, batchId, ideaId: "idea-1", kind: "final", prompt: SCENE, fromId: done.value.image.id });
    expect(final).toEqual(refused(/render_submit cannot run yet|owner has picked none/));
    expect(studio.fal.submits()).toHaveLength(1);
  });

  it("lets only the owner send a render, and only with the house rules read", async () => {
    expect(await callTool(studio, "render_submit", { rulesVersion: RULES_VERSION, batchId, ideaId: "idea-1", kind: "draft", prompt: SCENE }, { sub: "sub-member" })).toEqual(refused(/Only the owner/));
    expect(await callTool(studio, "render_submit", { batchId, ideaId: "idea-1", kind: "draft", prompt: SCENE })).toEqual(refused(/Call rules_get/));
  });

  it("gives the money back when fal refuses the job, and keeps it counted when the outcome is not known", async () => {
    await batchAtIdeas({ fal: (call) => (call.method === "POST" ? { status: 422, json: { detail: "bad input" } } : undefined) });
    expect(await draft()).toEqual(refused(/fal refused the render request \(status 422\)\. Nothing was charged/));
    expect((await studio.spend.ledger.summary(batchId)).batchUsd).toBe(0);

    await batchAtIdeas({ fal: (call) => (call.method === "POST" ? new Error("socket hang up") : undefined) });
    expect(await draft()).toEqual(refused(/outcome is not known/));
    expect(await studio.spend.ledger.summary(batchId)).toMatchObject({ batchUsd: 0.009, lines: [expect.objectContaining({ status: "reserved" })] });
  });
});

describe("render_status", () => {
  it("marks the render failed when fal fails, releases the reserve, and does not release it twice", async () => {
    await batchAtIdeas({ fal: (call) => (call.method === "GET" && !call.url.endsWith("/status") ? { status: 422, json: { detail: "content policy" } } : undefined) });
    const first = await draft();
    expect((await studio.spend.ledger.summary(batchId)).batchUsd).toBe(0.009);
    const failed = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(failed.value).toMatchObject({ status: "failed", error: expect.stringMatching(/did not make the picture \(status 422\)/) });
    expect(failed.value.error).not.toMatch(/content policy/);
    await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(await studio.spend.ledger.summary(batchId)).toMatchObject({ batchUsd: 0, lines: [expect.objectContaining({ status: "released", usd: 0 })] });
    // A failed first draft leaves no price: the next draft goes alone again.
    expect((await draft()).value.note).toMatch(/goes alone/);
  });

  it("keeps the money spent when fal made the picture and the studio could not copy it", async () => {
    let copies = false;
    await batchAtIdeas({ fal: (call) => (!copies && call.method === "GET" && call.url.includes("fal.media") ? { status: 404, json: {} } : undefined) });
    const first = await draft();
    const failed = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(failed.value).toMatchObject({ status: "failed", error: expect.stringMatching(/could not be copied/) });
    expect(await studio.spend.ledger.summary(batchId)).toMatchObject({ batchUsd: 0.009, lines: [expect.objectContaining({ status: "spent" })] });
    // The failed draft was charged, so its price stays in what the stage came to.
    expect(failed.value.billed).toBe(true);
    copies = true;
    // The draft sent in its place reads the price, and the quote counts the charge for the one that failed.
    const second = await draft();
    const done = await callTool(studio, "render_status", { batchId, renderId: second.value.id });
    expect(done.value).toMatchObject({ status: "done", note: expect.stringMatching(/9 drafts come to about US\$0\.09/) });
    expect((await studio.spend.gate.peek(batchId, "drafts"))?.estimateUsd).toBeCloseTo(0.009 * 10);
    // The next draft does not move it.
    expect((await draft({ ideaId: "idea-2" })).ok).toBe(true);
    expect((await studio.spend.gate.peek(batchId, "drafts"))?.estimateUsd).toBeCloseTo(0.009 * 10);
  });

  it("leaves the render queued while fal is busy, and copies the picture once when two reads meet", async () => {
    let busy = true;
    await batchAtIdeas({ fal: (call) => (busy && call.url.endsWith("/status") ? { status: 503 } : undefined) });
    const first = await draft();
    expect((await callTool(studio, "render_status", { batchId, renderId: first.value.id })).value).toMatchObject({ status: "queued", note: expect.stringMatching(/busy/) });
    busy = false;
    const both = await Promise.all([1, 2].map(() => callTool(studio, "render_status", { batchId, renderId: first.value.id })));
    expect(both.map((read) => read.value.status)).toEqual(["done", "done"]);
    expect((await callTool(studio, "render_list", { batchId })).value.renders).toHaveLength(1);
    expect(await studio.spend.ledger.summary(batchId)).toMatchObject({ batchUsd: 0.009, lines: [expect.objectContaining({ status: "spent" })] });
    expect((await studio.services.images.list(batchId, "draft"))).toHaveLength(1);
  });

  it("keeps the first read's result when a second read with another result ends the render after it", async () => {
    await batchAtIdeas();
    const renders = new RenderStore(studio.table, () => studio.clock.now);
    const first = await draft();
    const queued = await renders.get(batchId, first.value.id);
    // The first read has set its mark and not yet written the render; the second one saw a failure.
    await studio.table.put({ pk: `BATCH#${batchId}`, sk: `ENDED#${queued.id}`, result: { status: "done", imageId: queued.id }, updatedAt: "2026-11-22T10:00:00.000Z" });
    expect(await renders.end(queued, { status: "failed", error: "the picture could not be copied" })).toBe(false);
    expect(await renders.get(batchId, queued.id)).toMatchObject({ status: "done", imageId: queued.id });
  });

  it("does not open a result or a picture that is not at a fal address, and sends the key to the queue only", async () => {
    await batchAtIdeas({ fal: (call) => (call.method === "GET" && call.url.startsWith("https://queue.fal.run/") && !call.url.endsWith("/status") ? { json: { images: [{ url: "https://169.254.169.254/latest/meta-data" }] } } : undefined) });
    const first = await draft();
    const read = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(read.value).toMatchObject({ status: "failed", error: expect.stringMatching(/not at an https fal address/) });
    expect(studio.fal.calls.some((call) => call.url.includes("169.254"))).toBe(false);

    await batchAtIdeas();
    const second = await draft();
    await callTool(studio, "render_status", { batchId, renderId: second.value.id });
    const picture = studio.fal.calls.find((call) => call.url.includes("fal.media"));
    expect(picture?.key).toBeNull();
  });
});
