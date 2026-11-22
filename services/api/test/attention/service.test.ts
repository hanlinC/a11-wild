import type { Attention, BatchState, Idea, MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { todayPage } from "../../src/outreach/today.js";
import { savedProduct } from "../helpers/batch.js";
import { createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";
import { JPEG } from "../helpers/pictures.js";
import { loadProspects, row } from "../outreach/helpers.js";

const OWNER = "owner@example.com";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });
const AD = { batchId: "b", imageId: "i", kind: "v1" as const, key: "outreach/x/1.png", why: "The pack on its colour." };

const IDEAS = [1, 2, 3].map((n) => ({ id: `idea-${n}`, title: `Idea ${n}` })) as Idea[];

let studio: Studio;
let of: Awaited<ReturnType<typeof savedProduct>>;

const read = async (role: "owner" | "member" = "owner"): Promise<Attention> => json(await studio.app.request("/api/attention", { headers: { cookie: await sessionCookie(studio, role) } }));
const step = () => {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
};

/** A batch put at a state, as the steps before it would leave it. */
async function batchAt(state: BatchState, create: { kind?: "v1" | "v2" | "v3"; test?: true; purpose?: "outreach"; label?: string } = {}) {
  const made = await studio.services.batches.create({ kind: "v1", brandId: of.brand.id, productId: of.product.id, format: "static_4x5", createdBy: OWNER, ...create });
  await studio.table.put({ pk: "BATCH", sk: made.id, ...made, state });
  await studio.services.batches.saveIdeas(made.id, IDEAS, OWNER);
  step();
  return made.id;
}

/** The first draft gave a price, so the stage has its estimate: three at this price each. */
const priced = (id: string, stage: "drafts" | "finals", firstUsd: number) => studio.services.gate.price(id, stage, { firstUsd, count: 3 });
const pick = (id: string, ideaId: string, imageId: string | null = `${ideaId}-d1`) => studio.services.picks.save(id, { ideaId, imageId, ownerSaid: "this one", by: OWNER });
const first = async () => (await read()).batches[0];

beforeEach(async () => {
  studio = await createStudio();
  // A Monday morning in Singapore.
  studio.clock.now = new Date("2026-11-23T02:00:00Z");
  of = await savedProduct(studio);
});

describe("what waits for the owner", () => {
  it("is nothing in an empty studio", async () => {
    expect(await read()).toEqual({ batches: [], lines: [], counts: { studio: 0, outreach: 0, clients: 0, taste: 0, connections: 0 } });
  });

  it("answers 401 with no session", async () => {
    expect((await studio.app.request("/api/attention")).status).toBe(401);
  });

  it("names each batch with who acts next, newest first, and counts the ones that wait for the owner", async () => {
    const drafting = await batchAt("drafting", { label: "W47" });
    const pick = await batchAt("waiting_pick");
    const concepts = await batchAt("reviewed", { kind: "v3" });
    const done = await batchAt("done");

    const { batches, counts } = await read();

    expect(batches.map((line) => [line.batch.id, line.who, line.to])).toEqual([
      [done, "nobody", `/batches/${done}`],
      [concepts, "owner", `/batches/${concepts}/concepts`],
      [pick, "owner", `/batches/${pick}`],
      [drafting, "agent", `/batches/${drafting}`],
    ]);
    expect(batches.at(-1)).toMatchObject({ batch: { label: "W47", kind: "v1", state: "drafting" }, brand: { name: "WonGi" }, product: { name: "Seaweed crisps" } });
    expect(counts.studio).toBe(2);
  });

  it("does not count a test batch or an outreach batch that is at the owner's step", async () => {
    await batchAt("waiting_pick", { test: true });
    await batchAt("waiting_pick", { purpose: "outreach" });

    const { batches, counts } = await read();

    // The drafts of an outreach batch wait for the owner on the brand's page: Outreach counts them, the Studio does not.
    expect(batches.map((line) => [line.batch.purpose ?? "test", line.who])).toEqual([["outreach", "nobody"], ["test", "agent"]]);
    expect(counts.studio).toBe(0);
  });

  it("asks for a pick only while an idea has none, also after the first final is started", async () => {
    const id = await batchAt("waiting_pick");
    await pick(id, "idea-1");
    await pick(id, "idea-2", null);
    expect(await first()).toMatchObject({ who: "owner", text: "Pick one draft for each idea." });

    // The agent starts the final of the first idea: the batch goes on, and the third idea still has no pick.
    await studio.table.put({ pk: "BATCH", sk: id, ...(await studio.services.batches.get(id)), state: "finals" });
    expect(await first()).toMatchObject({ who: "owner", text: "Pick one draft for each idea." });

    await pick(id, "idea-3");
    expect(await first()).toMatchObject({ who: "agent", text: "The agent makes the finals." });
    await studio.table.put({ pk: "BATCH", sk: id, ...(await studio.services.batches.get(id)), state: "waiting_pick" });
    expect(await first()).toMatchObject({ who: "agent", text: "The agent makes the finals." });
    expect((await read()).counts.studio).toBe(0);
  });

  it("asks for a yes to a cost of US$1 or more at the step it is asked at, until the owner gives it", async () => {
    const id = await batchAt("priced", { kind: "v2" });
    expect((await first())?.who).toBe("agent");

    await priced(id, "drafts", 0.2);
    expect((await first())?.who).toBe("agent");

    await priced(id, "drafts", 0.4);
    expect(await first()).toMatchObject({ who: "owner", text: "Say yes or no to the cost of the drafts.", chat: true });

    await studio.services.gate.approve(id, "drafts", { email: OWNER, role: "owner" });
    expect((await first())?.who).toBe("agent");
  });

  it("asks for a yes to the cost of the finals, and not for one of a stage the batch has left", async () => {
    const id = await batchAt("finals");
    for (const idea of IDEAS) await pick(id, idea.id);
    await priced(id, "drafts", 0.4);
    expect((await first())?.who).toBe("agent");

    await priced(id, "finals", 0.5);
    expect(await first()).toMatchObject({ who: "owner", text: "Say yes or no to the cost of the finals.", chat: true });
  });

  it("asks again when Meta text is saved after the owner's yes, until he says yes to it or to the older text again", async () => {
    const id = await batchAt("done", { kind: "v2" });
    const one = await studio.services.meta.save(id, { ideaId: "idea-1", variants: [variant("A"), variant("B")], by: "agent" });
    step();
    await studio.services.meta.approve(id, { ideaId: "idea-1", version: one.version, ownerSaid: "yes", by: OWNER });
    step();
    const two = await studio.services.meta.save(id, { ideaId: "idea-1", variants: [variant("C"), variant("D")], by: "agent" });
    expect(await first()).toMatchObject({ who: "owner", text: "Say yes or no to the Meta text.", chat: true });

    step();
    await studio.services.meta.approve(id, { ideaId: "idea-1", version: one.version, ownerSaid: "keep the first", by: OWNER });
    expect((await first())?.who).toBe("nobody");

    step();
    const three = await studio.services.meta.save(id, { ideaId: "idea-1", variants: [variant("E"), variant("F")], by: "agent" });
    expect((await first())?.who).toBe("owner");
    step();
    await studio.services.meta.approve(id, { ideaId: "idea-1", version: three.version, ownerSaid: "yes", by: OWNER });
    expect((await first())?.who).toBe("nobody");
    expect(two.version).toBe(2);
  });

  it("waits for the owner's yes to Meta text until one version of each ad has it", async () => {
    const id = await batchAt("done", { kind: "v2" });
    expect((await read()).batches[0]?.who).toBe("nobody");

    const text = await studio.services.meta.save(id, { ideaId: "idea-1", variants: [variant("A"), variant("B")], by: "agent" });
    expect((await read()).batches[0]).toMatchObject({ who: "owner", chat: true });

    await studio.services.meta.approve(id, { ideaId: "idea-1", version: text.version, ownerSaid: "yes", by: OWNER });
    expect((await read()).batches[0]?.who).toBe("nobody");
  });

  it("counts the outreach work as the Today page lists it", async () => {
    const [first, second, third] = await loadProspects(studio, [row(1), row(2), row(3)]);
    const { store, sequence } = studio.services.outreach;
    // One ad waits for a look, one brand is ready for its first message, one has no ad.
    await store.addAd(first as string, AD);
    await store.addAd(second as string, AD);
    await sequence.verdict(second as string, { ad: 1, yes: true });
    step();

    const { lines, counts } = await read();
    const today = await todayPage({ store, sequence, pictures: studio.pictures, now: () => studio.clock.now });

    expect(lines).toEqual([
      { kind: "ads", count: 1, to: "/outreach" },
      { kind: "firsts", count: 1, to: "/outreach" },
    ]);
    expect([today.adsWaiting.length, today.firsts.length, today.owed.length, today.followUps.length]).toEqual([1, 1, 0, 0]);
    expect(counts.outreach).toBe(2);
    expect(third).toBeDefined();
  });

  it("counts a change request until the owner closes it, a taste change that waits, and a program that waits", async () => {
    const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: JPEG.length }]);
    await studio.pictures.put(`carried/${carryId}/0`, JPEG, "image/jpeg");
    const made = await studio.services.pack.carry(OWNER, { carryId, brandId: of.brand.id, product: "Cake", ads: [{ adName: "a11_cake_tof", picture: 0, variants: [variant("A"), variant("B")], why: "Why.", claims: [] }], launchPlan: ["Run for 72 hours."] });
    const pack = await studio.services.packs.get(made.packId);
    const version = pack && (await studio.services.pack.current(pack));
    if (!pack || !version) throw new Error("no pack");
    await studio.services.comments.send(pack, version, { text: "A plain comment." });
    const request = await studio.services.comments.send(pack, version, { text: "Make the cake bigger.", adName: "a11_cake_tof", change: "picture" });
    await studio.services.proposals.propose({ scope: { kind: "brand", brandId: of.brand.id }, text: "The pack is always whole.", reason: "He said so twice.", recordIds: [], by: "agent" });
    studio.cognito.register("client-9");
    await studio.approvals.statusOf("client-9", OWNER);

    const before = await read();
    expect(before.lines).toEqual([
      { kind: "change_requests", count: 1, to: "/clients" },
      { kind: "taste", count: 1, to: "/taste" },
      { kind: "connections", count: 1, to: "/connections" },
    ]);
    expect(before.counts).toMatchObject({ clients: 1, taste: 1, connections: 1 });

    const id = (await studio.services.comments.all(pack.id)).find((comment) => comment.text === request.text)?.id as string;
    await studio.services.comments.setStatus(pack, id, "done");
    await studio.approvals.approve("client-9");
    const after = await read();
    expect(after.lines.map((line) => line.kind)).toEqual(["taste"]);
  });

  it("tells a member nothing of a question the owner is asked in chat", async () => {
    await priced(await batchAt("waiting_spend"), "drafts", 0.4);
    expect((await read("member")).batches[0]).not.toHaveProperty("chat");
    expect((await read()).batches[0]).toMatchObject({ who: "owner", chat: true });
  });

  it("gives a member the batches only: no line and no count of the owner's", async () => {
    await batchAt("waiting_pick");
    await loadProspects(studio, [row(1)]).then(([id]) => studio.services.outreach.store.addAd(id as string, AD));
    studio.cognito.register("client-9");
    await studio.approvals.statusOf("client-9", OWNER);

    const seen = await read("member");

    expect(seen.lines).toEqual([]);
    expect(seen.counts).toEqual({ studio: 0 });
    expect(seen.batches.map((line) => [line.who, line.text, line.chat])).toEqual([["owner", "Waits for the owner.", undefined]]);
  });
});
