import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, config, createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";
import { reviewConcepts, roughOf, rules, v3AtConcepts } from "../helpers/v3.js";

let studio: Studio;
let batchId: string;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  ({ batchId } = await v3AtConcepts(studio));
});

const three = ["idea-2", "idea-4", "idea-5"].map((ideaId) => ({ ideaId, ownerSaid: `this one, ${ideaId}` }));
const show = async () => (await callTool(studio, "concept_board", { batchId })).value;

describe("the concept board", () => {
  it("shows every concept with its roughs, and the critic's review only of the set as it is now", async () => {
    const roughId = await roughOf(studio, batchId, "idea-2");
    const before = await show();
    expect(before).toMatchObject({ picking: "not_yet", reviewedAt: null, pick: null, brand: { name: "WonGi" }, product: { name: "Seaweed crisps" } });
    expect(before.concepts).toHaveLength(6);
    expect(before.concepts[1]).toMatchObject({ idea: { id: "idea-2", headline: "Gone again B" }, roughs: [{ imageId: roughId, viewUrl: expect.stringContaining("signed=1") }], review: null });
    expect(before.insights).toHaveLength(4);

    await reviewConcepts(studio, batchId, ["idea-2"]);
    const after = await show();
    expect(after.picking).toBe("open");
    expect(after.concepts[1].review).toMatchObject({ recommend: true, scores: { visual: 4 }, roughs: [roughId] });
    expect(after.concepts[0].review).toMatchObject({ recommend: false, roughs: [] });

    // A new rough makes the review old.
    await roughOf(studio, batchId, "idea-1");
    expect(await show()).toMatchObject({ picking: "not_yet", reviewedAt: null, concepts: expect.arrayContaining([expect.objectContaining({ review: null })]) });
  });

  it("marks the owner's pick, and closes when he approves the words", async () => {
    await reviewConcepts(studio, batchId);
    await callTool(studio, "concept_pick", { ...rules, batchId, picks: three });
    const picked = await show();
    expect(picked).toMatchObject({ picking: "open", batch: { state: "judged" }, pick: { picks: three, warnings: expect.any(Array) } });
    const words = three.map(({ ideaId }) => ({ ideaId, headline: "Gone again", subline: "It never reaches home.", ownerSaid: "yes" }));
    expect((await callTool(studio, "copy_approve", { ...rules, batchId, ideas: words })).ok).toBe(true);
    expect((await show()).picking).toBe("closed");
  });

  it("is given to a signed-in dashboard, and takes the owner's pick there from the same origin only", async () => {
    const path = `/api/batches/${batchId}/concepts`;
    expect((await studio.app.request(path)).status).toBe(401);
    expect((await studio.app.request("/api/batches/none/concepts", { headers: { cookie: await sessionCookie(studio) } })).status).toBe(404);
    await reviewConcepts(studio, batchId);
    const board = await json(await studio.app.request(path, { headers: { cookie: await sessionCookie(studio, "member") } }));
    expect(board).toMatchObject({ picking: "open", concepts: expect.any(Array) });

    const post = (cookie: string, origin: string, body: unknown = { picks: three }) =>
      studio.app.request(`/api/batches/${batchId}/concept-pick`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post(await sessionCookie(studio, "member"), config.publicOrigin)).status).toBe(403);
    expect((await post(await sessionCookie(studio), "https://evil.example")).status).toBe(403);
    expect((await post(await sessionCookie(studio), config.publicOrigin, { picks: three.slice(1) })).status).toBe(400);
    const refused = await post(await sessionCookie(studio), config.publicOrigin, { picks: [...three.slice(1), { ideaId: "idea-9", ownerSaid: "this" }] });
    expect(refused.status).toBe(400);
    expect(await json(refused)).toMatchObject({ error: "refused", message: expect.stringMatching(/no concept idea-9/) });
    const saved = await post(await sessionCookie(studio), config.publicOrigin);
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ state: "judged", picked: [{ id: "idea-2" }, { id: "idea-4" }, { id: "idea-5" }] });
  });
});
