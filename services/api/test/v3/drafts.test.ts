import { beforeEach, describe, expect, it } from "vitest";
import { batchAtTruth, idea, judgeIdeas } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { directionOf, rules, v3AtDirected } from "../helpers/v3.js";

const SCENE = "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.";

let studio: Studio;
let batchId: string;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  ({ batchId } = await v3AtDirected(studio));
});

const send = (ideaId: string, draft: number | undefined, extra: object = {}) =>
  callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind: "draft", prompt: SCENE, references: ["pack-1"], ...(draft ? { draft } : {}), ...extra });
const urls = () => studio.fal.submits().at(-1)?.body?.image_urls as string[];

describe("a draft of a concept ad", () => {
  it("answers one of the direction's three drafts, and starts from the concept's rough and the real photos", async () => {
    const roughs = (await studio.services.images.list(batchId, "rough")).filter((image) => image.ideaId === "idea-2");
    const sent = await send("idea-2", 2);
    expect(sent).toMatchObject({ ok: true, value: { kind: "draft", draft: 2, directionVersion: 1 } });
    expect(sent.value).not.toHaveProperty("fromId");
    // The rough is the first picture the model sees, then the real pack.
    expect(urls()).toEqual([`https://pictures.example/${roughs.at(-1)?.key}?signed=1`, "https://pictures.example/products/p/pack.jpg?signed=1"]);
  });

  it("is refused with no draft number, or one the direction does not have", async () => {
    const before = studio.fal.submits().length;
    expect(await send("idea-2", undefined)).toMatchObject({ ok: false, error: expect.stringMatching(/Say which draft of the direction this is: draft 1, 2, 3 of idea-2/) });
    expect((await send("idea-2", 4)).ok).toBe(false);
    expect(studio.fal.submits()).toHaveLength(before);
  });

  it("is sent once for each number", async () => {
    const first = await send("idea-2", 1);
    await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    await callTool(studio, "spend_approve", { ...rules, batchId, ownerSaid: "yes" });
    const before = studio.fal.submits().length;
    expect(await send("idea-2", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/Draft 1 of idea-2 \("Question 1\?"\) is already sent/) });
    expect(studio.fal.submits()).toHaveLength(before);
    expect(await send("idea-2", 3)).toMatchObject({ ok: true, value: { draft: 3 } });
  });

  it("gets the real photo of everything the concept shows", async () => {
    const before = studio.fal.submits().length;
    expect(await send("idea-2", 1, { references: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: concept idea-2 shows pack-1/) });
    expect(studio.fal.submits()).toHaveLength(before);
  });

  it("can still be built round a skeleton that holds the real pack", async () => {
    await studio.services.images.add({ id: "s1", batchId, kind: "skeleton", key: `batches/${batchId}/skeletons/s1.png` });
    // Round a skeleton too, the model sees the real photo of each thing the concept shows.
    expect(await send("idea-2", 1, { fromId: "s1", references: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: concept idea-2 shows pack-1/) });
    const sent = await send("idea-2", 1, { fromId: "s1" });
    expect(sent).toMatchObject({ ok: true, value: { fromId: "s1", draft: 1 } });
    expect(urls()[0]).toBe(`https://pictures.example/batches/${batchId}/skeletons/s1.png?signed=1`);
    expect(urls()).toHaveLength(3);
  });

  it("is measured against the pack photo the model was given", async () => {
    const got = (await callTool(studio, "batch_get", { batchId })).value;
    await studio.services.brands.saveProduct({ ...got.product, photos: [...got.product.photos, { key: "products/p/pack-big.jpg", sourceUrl: "https://cdn.wongi.example/pack-big.jpg", kind: "pack", what: "The 230 g pouch" }], savedBy: "owner@example.com" });
    const measured = async (references: string[], draft: number) => {
      const sent = await send("idea-2", draft, { references });
      const { image } = (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value;
      if ((await callTool(studio, "batch_get", { batchId })).value.batch.state === "waiting_spend") await callTool(studio, "spend_approve", { ...rules, batchId, ownerSaid: "yes" });
      const job = await callTool(studio, "pack_check", { batchId, imageId: image.id, at: [500, 800], bg: "FFD21E" });
      expect(job.ok ? "" : job.error).toBe("");
      return studio.pixels.events.at(-1)!.input.packKey;
    };
    expect(await measured(["pack-2", "pack-1"], 1)).toBe("products/p/pack-big.jpg");
    expect(await measured(["pack-1"], 2)).toBe("products/p/pack.jpg");
  });

  it("with no rough starts from a plan of the real photos", async () => {
    for (const rough of (await studio.services.images.list(batchId, "rough")).filter((image) => image.ideaId === "idea-2")) await studio.table.delete(`BATCH#${batchId}`, `IMAGE#${rough.id}`);
    const before = studio.fal.submits().length;
    expect(await send("idea-2", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/Concept idea-2 has no rough, so its draft starts from a plan of the real photos/) });
    expect(studio.fal.submits()).toHaveLength(before);
    await studio.services.images.add({ id: "s1", batchId, kind: "skeleton", key: `batches/${batchId}/skeletons/s1.png` });
    expect((await send("idea-2", 1, { fromId: "s1" })).ok).toBe(true);
    expect(urls()).toHaveLength(2);
  });

  it("gets its rough on top of four real photos", async () => {
    const got = (await callTool(studio, "batch_get", { batchId })).value;
    const more = [1, 2].map((n) => ({ key: `products/p/prop${n}.jpg`, sourceUrl: `https://cdn.wongi.example/prop${n}.jpg`, kind: "prop" as const, what: `Prop ${n}` }));
    await studio.services.brands.saveProduct({ ...got.product, photos: [...got.product.photos, ...more], savedBy: "owner@example.com" });
    const four = await send("idea-2", 1, { references: ["pack-1", "food-1", "prop-1", "prop-2"] });
    expect(four.ok ? "" : four.error).toBe("");
    expect(urls()).toHaveLength(5);
    // With no rough, the plan the draft starts from is on top of the four photos too.
    for (const rough of (await studio.services.images.list(batchId, "rough")).filter((image) => image.ideaId === "idea-4")) await studio.table.delete(`BATCH#${batchId}`, `IMAGE#${rough.id}`);
    await callTool(studio, "render_status", { batchId, renderId: four.value.id });
    await studio.services.images.add({ id: "s4", batchId, kind: "skeleton", key: `batches/${batchId}/skeletons/s4.png` });
    const planned = await send("idea-4", 1, { fromId: "s4", references: ["pack-1", "food-1", "prop-1", "prop-2"] });
    expect(planned.ok ? "" : planned.error).toBe("");
    expect(urls()).toHaveLength(5);
  });

  it("keeps the draft number for v3 only", async () => {
    const v1 = await batchAtTruth(studio);
    await callTool(studio, "ideas_save", { ...rules, batchId: v1.batchId, ideas: [idea(1), idea(2), idea(3)] });
    await judgeIdeas(studio, v1.batchId);
    const before = studio.fal.submits().length;
    const refused = await callTool(studio, "render_submit", { ...rules, batchId: v1.batchId, ideaId: "idea-1", kind: "draft", prompt: SCENE, references: [], draft: 1 });
    expect(studio.fal.submits()).toHaveLength(before);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/Only a draft of a concept ad/) });
  });
});

describe("a real-photo plan", () => {
  const plan = (products: object[]) => ({ bg: "FFD21E", products });

  it("is made after the direction, from the product's saved real photos by name", async () => {
    const made = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.3, base: 0.8, height: 0.3 }, { cx: 0.7, base: 0.8, height: 0.2, photo: "food-1" }]) });
    expect(made.ok ? "" : made.error).toBe("");
    const { input } = studio.pixels.events.at(-1)!;
    expect(input).toMatchObject({ packKey: "products/p/pack.jpg", plan: { products: [{ cx: 0.3 }, { cx: 0.7, photoKey: "products/p/food.jpg" }] } });
    // A photo the product does not have is refused, and no file name an agent types is read.
    expect(await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.5, base: 0.8, height: 0.3, photo: "prop-1" }]) })).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: this product has no photo prop-1/) });
    expect((await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.5, base: 0.8, height: 0.3, photoKey: "products/other/x.jpg" }]) })).ok).toBe(false);
  });

  it("is saved beside its picture, and the draft built round it keeps it", async () => {
    const made = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.5, base: 0.8, height: 0.4, photo: "food-1" }]) });
    const skeleton = (await callTool(studio, "pixel_status", { batchId, jobId: made.value.id })).value.image.id as string;
    expect((await studio.services.jobs.get(batchId, skeleton)).input).toMatchObject({ plan: { bg: "#FFD21E", products: [{ photoKey: "products/p/food.jpg", height: 0.4 }] } });
    const sent = await send("idea-2", 1, { fromId: skeleton });
    expect(sent).toMatchObject({ ok: true, value: { fromId: skeleton } });
  });

  it("needs no pack photo when each item names a real photo", async () => {
    const got = (await callTool(studio, "batch_get", { batchId })).value;
    await studio.services.brands.saveProduct({ ...got.product, photos: got.product.photos.filter((photo: { kind: string }) => photo.kind !== "pack"), savedBy: "owner@example.com" });
    const bare = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", bg: "FFD21E" });
    expect(bare).toMatchObject({ ok: false, error: expect.stringMatching(/this product has no pack photo, so the skeleton is a plan in which each item names a saved real photo/) });
    const mixed = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.3, base: 0.8, height: 0.3 }, { cx: 0.7, base: 0.8, height: 0.2, photo: "food-1" }]) });
    expect(mixed.ok).toBe(false);
    const made = await callTool(studio, "skeleton_make", { ...rules, batchId, ideaId: "idea-2", plan: plan([{ cx: 0.5, base: 0.8, height: 0.4, photo: "food-1" }]) });
    expect(made.ok ? "" : made.error).toBe("");
    expect(studio.pixels.events.at(-1)!.input).not.toHaveProperty("packKey");
  });
});

describe("a draft that shows the food alone", () => {
  // The real failure (IRVINS concept ads, 22-11-2026): a row of real fish skin pieces with no pouch in it could never be checked,
  // because the product has a pack photo and the board asked for the pack measure of a picture with no pack.
  it("owes no pack measure, and a draft that shows the pack still does", async () => {
    const ideas = await studio.services.batches.ideas(batchId);
    await studio.services.batches.saveIdeas(batchId, ideas.map((idea) => (idea.id === "idea-4" ? { ...idea, shows: ["food-1"] } : idea)), "owner@example.com");
    const made = async (ideaId: string, references: string[]) => {
      const sent = await send(ideaId, 1, { references });
      if (!sent.ok) throw new Error(sent.error);
      return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id as string;
    };
    const food = await made("idea-4", ["food-1"]);
    const pack = await made("idea-2", ["pack-1"]);
    await callTool(studio, "checks_save", { ...rules, batchId, imageId: food, items: [] });
    const looked = await callTool(studio, "checks_save", { ...rules, batchId, imageId: pack, items: [] });
    expect(looked.value.stillMissing).toContain(`pack_check for picture ${pack}`);
    expect(looked.value.stillMissing).not.toContain(`pack_check for picture ${food}`);
    expect(looked.value.stillMissing).not.toContain(`checks_save for picture ${food}`);
  });

  it("is measured turned upright when the pack lies at an angle", async () => {
    const sent = await send("idea-2", 1);
    const image = (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image;
    await callTool(studio, "pack_check", { batchId, imageId: image.id, at: [500, 800], bg: "FFD21E", tilted: true });
    expect(studio.pixels.events.at(-1)!.input).toMatchObject({ tilted: true, sideways: false });
  });
});

describe("a draft that its checks reject", () => {
  /** Sends a draft and reads it until it is done. Returns its picture id. */
  async function made(ideaId: string, draft: number): Promise<string> {
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const sent = await send(ideaId, draft, { prompt: `${SCENE} Draft ${draft}.` });
    if (!sent.ok) throw new Error(sent.error);
    const read = await callTool(studio, "render_status", { batchId, renderId: sent.value.id });
    if ((await callTool(studio, "batch_get", { batchId })).value.batch.state === "waiting_spend") await callTool(studio, "spend_approve", { ...rules, batchId, ownerSaid: "yes" });
    return read.value.image.id as string;
  }
  const look = (imageId: string, items: object[]) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
  const shown = async () => (await studio.services.board.board(batchId)).ideas.find((entry) => entry.idea.id === "idea-2")!.drafts.map((draft) => draft.image.id);

  it("is made again once, and the redo stands in its place", async () => {
    const first = await made("idea-2", 1);
    // A draft that passes, or that no one has looked at, is not made again.
    expect(await send("idea-2", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/made again once, and only when its checks reject it/) });
    await look(first, []);
    expect((await send("idea-2", 1)).ok).toBe(false);
    await look(first, [{ code: "D11", note: "The pouch is too wide." }]);
    const before = studio.fal.submits().length;
    const redo = await made("idea-2", 1);
    expect(studio.fal.submits()).toHaveLength(before + 1);
    expect((await studio.services.renders.get(batchId, redo)).redoOf).toBe(first);
    expect(await shown()).toEqual([redo]);
    // The other two drafts are still made: the rejected one does not take a place.
    await made("idea-2", 2);
    await made("idea-2", 3);
    expect(await shown()).toHaveLength(3);
    expect(await shown()).not.toContain(first);
  });

  it("is made again when only the picture with its words is rejected", async () => {
    const first = await made("idea-2", 1);
    await look(first, []);
    const words = (await studio.services.copy.list(batchId)).find((entry) => entry.ideaId === "idea-2")!;
    await studio.services.images.add({ id: "t1", batchId, kind: "typeset", key: `batches/${batchId}/typeset/t1.png`, ideaId: "idea-2", fromId: first, rootId: first, wordsVersion: words.version });
    await look("t1", [{ code: "F6", note: "The headline covers the pouch." }, { code: "F7", note: "The words do not stand clear." }]);
    const redo = await send("idea-2", 1);
    expect(redo.ok ? "" : redo.error).toBe("");
  });

  it("is made again round the skeleton it was built round", async () => {
    // Found live (IRVINS concept ads, 22-11-2026): the redo of a draft from its own skeleton was refused as R23.
    await studio.services.images.add({ id: "s1", batchId, kind: "skeleton", key: `batches/${batchId}/skeletons/s1.png` });
    const sent = await send("idea-2", 1, { fromId: "s1" });
    const first = (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id as string;
    await look(first, [{ code: "D11", note: "The pouch is too tall." }]);
    // Another draft of the concept still needs its own skeleton.
    expect(await send("idea-2", 2, { fromId: "s1" })).toMatchObject({ ok: false, error: expect.stringMatching(/R23/) });
    const redo = await send("idea-2", 1, { fromId: "s1" });
    expect(redo.ok ? "" : redo.error).toBe("");
    expect(redo.value).toMatchObject({ fromId: "s1" });
  });

  it("is not asked for its type again when the bare picture is the fault", async () => {
    // Found live (IRVINS concept ads, 22-11-2026): a pouch drawn too tall kept the board asking for type_set again.
    const first = await made("idea-2", 1);
    const words = (await studio.services.copy.list(batchId)).find((entry) => entry.ideaId === "idea-2")!;
    await studio.services.images.add({ id: "t1", batchId, kind: "typeset", key: `batches/${batchId}/typeset/t1.png`, ideaId: "idea-2", fromId: first, rootId: first, wordsVersion: words.version });
    const missing = async () => (await studio.services.board.progress({ ...(await studio.services.batches.get(batchId)), state: "drafting" })).missing.join(" | ");
    await look(first, []);
    await look("t1", [{ code: "D11", note: "The pouch is too tall." }]);
    expect(await missing()).toContain(`type_set again for picture ${first}: with its words it has D11`);
    await look(first, [{ code: "D11", note: "The pouch is too tall." }]);
    expect(await missing()).not.toMatch(/type_set again/);
  });

  it("is not made a third time", async () => {
    const first = await made("idea-2", 1);
    await look(first, [{ code: "F1", note: "The pouch is as big as the hand." }, { code: "F6", note: "Seven things in the frame." }]);
    const redo = await made("idea-2", 1);
    await look(redo, [{ code: "D2", note: "The crisps look like wax." }]);
    const before = studio.fal.submits().length;
    expect(await send("idea-2", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/It has had its one redo.*save a new direction with a lower risk/) });
    expect(studio.fal.submits()).toHaveLength(before);
  });

  it("starts again from a lower-risk direction of its concept", async () => {
    const direct = (concepts: object[]) => callTool(studio, "direction_save", { ...rules, batchId, concepts });
    const kept = ["idea-4", "idea-5"].map((ideaId) => directionOf(ideaId));
    const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state;
    expect((await direct([directionOf("idea-2", { risk: "medium" }), ...kept])).ok).toBe(true);
    const first = await made("idea-2", 1);
    await look(first, [{ code: "D2", note: "The crisps look like wax." }]);
    const redo = await made("idea-2", 1);
    await look(redo, [{ code: "D2", note: "The crisps look like wax." }]);
    const other = await made("idea-4", 1);
    expect(await state()).toBe("drafting");
    // The same risk again is not a lower-risk direction, and no other concept changes with it.
    expect(await direct([directionOf("idea-2", { risk: "medium", look: "A plain white table." }), ...kept])).toMatchObject({ ok: false, error: expect.stringMatching(/changes only to a lower risk: idea-2 stays at medium or goes up/) });
    expect(await direct([directionOf("idea-2", { risk: "low" }), directionOf("idea-4", { look: "A plain white table." }), directionOf("idea-5")])).toMatchObject({ ok: false, error: expect.stringMatching(/changes only after a draft of it was made again and its checks reject the redo too: not idea-4/) });
    const lowered = await direct([directionOf("idea-2", { risk: "low", look: "A plain white table." }), ...kept]);
    expect(lowered.ok ? "" : lowered.error).toBe("");
    expect(await state()).toBe("drafting");
    const { version } = lowered.value.direction;
    expect(lowered.value.direction.concepts.map((concept: { since: number }) => concept.since)).toEqual([version, 1, 1]);
    // The concept starts again with three drafts; the other concept keeps the draft it has.
    const again = await made("idea-2", 1);
    expect(await studio.services.renders.get(batchId, again)).toMatchObject({ directionVersion: version });
    expect(await studio.services.renders.get(batchId, again)).not.toHaveProperty("redoOf");
    expect((await send("idea-4", 1)).ok).toBe(false);
    expect(await shown()).toEqual([again]);
    // The new direction has its own one redo, and a concept at low takes a plainer look at low.
    await look(again, [{ code: "D2", note: "The crisps look like wax." }]);
    expect((await direct([directionOf("idea-2", { risk: "low" }), ...kept])).ok).toBe(false);
    await look(await made("idea-2", 1), [{ code: "D2", note: "The crisps look like wax." }]);
    expect((await direct([directionOf("idea-2", { risk: "medium" }), ...kept])).ok).toBe(false);
    // The other concepts go back as direction_get gave them, with the fields the studio set.
    const read = (await callTool(studio, "direction_get", { batchId })).value.direction.concepts as { ideaId: string; since: number }[];
    const asRead = await direct([directionOf("idea-2", { risk: "low", look: "Only the pouch, from above." }), ...read.filter((concept) => concept.ideaId !== "idea-2").map((concept) => ({ ...concept, since: 99 }))]);
    expect(asRead.ok ? "" : asRead.error).toBe("");
    expect(asRead.value.direction.concepts.map((concept: { since: number }) => concept.since)).toEqual([asRead.value.direction.version, 1, 1]);
    expect((await studio.services.board.board(batchId)).ideas.find((entry) => entry.idea.id === "idea-4")!.drafts.map((draft) => draft.image.id)).toEqual([other]);
  });
});
