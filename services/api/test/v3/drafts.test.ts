import { beforeEach, describe, expect, it } from "vitest";
import { batchAtTruth, idea, judgeIdeas } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { rules, v3AtDirected } from "../helpers/v3.js";

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
    const sent = await send("idea-2", 1, { fromId: "s1", references: [] });
    expect(sent).toMatchObject({ ok: true, value: { fromId: "s1", draft: 1 } });
    expect(urls()[0]).toBe(`https://pictures.example/batches/${batchId}/skeletons/s1.png?signed=1`);
    expect(urls()).toHaveLength(2);
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
