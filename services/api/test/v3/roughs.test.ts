import { beforeEach, describe, expect, it } from "vitest";
import { batchAtTruth, idea, judgeIdeas } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import type { FalCall } from "../helpers/fal.js";
import { brief, concepts, rules, v3AtConcepts, v3AtTruth } from "../helpers/v3.js";

const SCENE = "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.";

let studio: Studio;
let batchId: string;
const start = async (fal?: (call: FalCall) => { status?: number; json?: unknown } | undefined) => {
  studio = await createStudio(fal ? { fal } : {});
  await approvedClient(studio);
  ({ batchId } = await v3AtConcepts(studio));
};
beforeEach(() => start());

const send = (ideaId: string, extra: object = {}) => callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind: "rough", prompt: SCENE, references: ["pack-1"], ...extra });
/** Sends a rough and reads it until it is done. */
async function rough(ideaId: string) {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const sent = await send(ideaId);
  if (!sent.ok) return sent;
  return callTool(studio, "render_status", { batchId, renderId: sent.value.id });
}
const state = async () => (await callTool(studio, "batch_get", { batchId })).value.batch.state as string;

describe("a rough of a concept", () => {
  it("is made of any concept of the set, with no words approved, at the draft size and through the spend gate", async () => {
    const first = await send("idea-4");
    expect(first.value).toMatchObject({ kind: "rough", ideaId: "idea-4", status: "queued", note: expect.stringMatching(/first of the roughs/) });
    expect(studio.fal.submits()[0]?.body).toMatchObject({ image_size: { width: 1024, height: 1280 }, quality: "low" });
    // The rest wait for the price of the first.
    expect(await send("idea-5")).toMatchObject({ ok: false, error: expect.stringMatching(/first of the roughs is out to read the price/) });
    const done = await callTool(studio, "render_status", { batchId, renderId: first.value.id });
    expect(done.value).toMatchObject({ status: "done", image: { kind: "rough", ideaId: "idea-4" }, note: expect.stringMatching(/8 roughs come to about US\$.*under US\$1/) });
    expect((await rough("idea-5")).value.status).toBe("done");
    expect(await state()).toBe("ideas");
  });

  it("stops at two for one concept and at eight for the batch", async () => {
    expect((await rough("idea-1")).value.status).toBe("done");
    expect((await rough("idea-1")).value.status).toBe("done");
    expect(await rough("idea-1")).toMatchObject({ ok: false, error: expect.stringMatching(/Concept idea-1 has its 2 roughs/) });
    for (const ideaId of ["idea-2", "idea-2", "idea-3", "idea-3", "idea-4", "idea-4"]) expect((await rough(ideaId)).ok).toBe(true);
    expect(await rough("idea-5")).toMatchObject({ ok: false, error: expect.stringMatching(/This batch has its 8 roughs/) });
    // The refused call took no place from its concept.
    expect(studio.fal.submits()).toHaveLength(8);
  });

  it("gives the last place to one of two calls sent at the same moment", async () => {
    expect((await rough("idea-1")).value.status).toBe("done");
    const both = await Promise.all([send("idea-1"), send("idea-1")]);
    expect(both.filter((sent) => sent.ok)).toHaveLength(1);
    expect(both.find((sent) => !sent.ok)).toMatchObject({ error: expect.stringMatching(/has its 2 roughs/) });
  });

  it("gives its place back when fal made no picture", async () => {
    let refuse = true;
    await start((call) => (refuse && call.method === "GET" && !call.url.endsWith("/status") ? { status: 422, json: { detail: "content policy" } } : undefined));
    expect((await rough("idea-1")).value.status).toBe("failed");
    expect((await rough("idea-1")).value.status).toBe("failed");
    refuse = false;
    expect((await rough("idea-1")).value.status).toBe("done");
    expect((await rough("idea-1")).value.status).toBe("done");
    expect((await rough("idea-1")).ok).toBe(false);
  });

  it("gives its place back when the call is refused before fal takes it", async () => {
    await start((call) => (call.method === "POST" ? { status: 422, json: { detail: "bad input" } } : undefined));
    for (let tries = 0; tries < 3; tries++) expect((await send("idea-1")).ok).toBe(false);
    expect((await callTool(studio, "render_list", { batchId })).value.renders).toEqual([]);
    const counts = await studio.table.get(`BATCH#${batchId}`, "ROUGHS");
    expect(counts).toMatchObject({ count: 0 });
  });

  it("is refused when a real photo the concept shows is not sent to the model", async () => {
    const none = await send("idea-1", { references: [] });
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: concept idea-1 shows pack-1\. Give the real photo/) });
    const logo = await send("idea-1", { references: ["logo"] });
    expect(logo).toMatchObject({ ok: false, error: expect.stringMatching(/shows pack-1/) });
  });

  it("is refused for a concept that shows an item with no real photo, and takes no skeleton", async () => {
    const { batchId: other } = await (async () => {
      const made = await v3AtTruth(studio);
      await callTool(studio, "brief_save", { ...rules, batchId: made.batchId, ...brief() });
      await callTool(studio, "concepts_save", { ...rules, batchId: made.batchId, concepts: concepts(6, () => ({ shows: ["pack-1", "food-1"] })) });
      return made;
    })();
    // The food photo is removed after the concepts were saved.
    const product = (await callTool(studio, "batch_get", { batchId: other })).value.product;
    await studio.services.brands.saveProduct({ ...product, photos: product.photos.filter((photo: { kind: string }) => photo.kind !== "food") });
    const refused = await callTool(studio, "render_submit", { ...rules, batchId: other, ideaId: "idea-1", kind: "rough", prompt: SCENE, references: ["pack-1"] });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/Real photos first: idea idea-1 shows food-1/) });
    expect(await send("idea-1", { fromId: "some-skeleton" })).toMatchObject({ ok: false, error: expect.stringMatching(/A rough has no skeleton/) });
    expect(await send("idea-9")).toMatchObject({ ok: false, error: expect.stringMatching(/no concept idea-9/) });
    expect(studio.fal.submits()).toHaveLength(0);
  });

  it("is not made before the concepts are saved, nor in a batch of another kind", async () => {
    const early = await v3AtTruth(studio);
    await callTool(studio, "brief_save", { ...rules, batchId: early.batchId, ...brief() });
    const before = await callTool(studio, "render_submit", { ...rules, batchId: early.batchId, ideaId: "idea-1", kind: "rough", prompt: SCENE, references: [] });
    expect(before.ok).toBe(false);

    const v1 = await batchAtTruth(studio);
    await callTool(studio, "ideas_save", { ...rules, batchId: v1.batchId, ideas: [idea(1), idea(2), idea(3)] });
    await judgeIdeas(studio, v1.batchId);
    const wrong = await callTool(studio, "render_submit", { ...rules, batchId: v1.batchId, ideaId: "idea-1", kind: "rough", prompt: SCENE, references: [] });
    expect(wrong).toMatchObject({ ok: false, error: expect.stringMatching(/Only a batch of concept ads \(v3\) has roughs/) });
    expect(studio.fal.submits()).toHaveLength(0);
  });
});
