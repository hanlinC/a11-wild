import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, savedProduct } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

const rules = { rulesVersion: RULES_VERSION };
const member = { sub: "sub-member" };

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

const record = (scope: object, extra: object = {}) => ({
  ...rules,
  observation: "The owner passed on every draft with a prop beside the food.",
  source: "The owner's words on the board.",
  scope,
  lesson: "The food is the picture. No prop beside it.",
  evidence: 1,
  confidence: "medium",
  examples: ["Idea 2, draft 1: he said 'the spoon is in the way'."],
  counterexamples: [],
  expectedEffect: "Fewer drafts passed on for clutter.",
  ...extra,
});

async function otherBrand() {
  return studio.services.brands.saveBrand({ name: "Oatly", url: "https://oatly.example/", logo: null, palette: [], fonts: [], savedBy: "owner@example.com" });
}

describe("canon scopes", () => {
  it("keeps the four canons apart, and a save with no scope is the owner's taste", async () => {
    const { brand } = await savedProduct(studio);
    await callTool(studio, "canon_save", { text: "One clever object.", reason: "His picks." });
    await callTool(studio, "canon_save", { text: "Show the cap.", reason: "He said so.", scope: { kind: "brand", brandId: brand.id } });
    await callTool(studio, "canon_save", { text: "One light source.", reason: "Seen in checks.", scope: { kind: "craft" } });
    await callTool(studio, "canon_save", { text: "A face lifts clicks.", reason: "Two results files.", scope: { kind: "performance" } });

    expect((await callTool(studio, "canon_get")).value).toMatchObject({ version: 1, text: "One clever object." });
    expect((await callTool(studio, "canon_get", { scope: { kind: "brand", brandId: brand.id } })).value).toMatchObject({ version: 1, text: "Show the cap." });
    expect((await callTool(studio, "canon_get", { scope: { kind: "craft" } })).value.text).toBe("One light source.");
    expect((await callTool(studio, "canon_get", { scope: { kind: "performance" } })).value.text).toBe("A face lifts clicks.");
    expect((await callTool(studio, "canon_versions", { scope: { kind: "craft" } })).value.versions).toHaveLength(1);
  });

  it("refuses a brand scope with no brand, a brand on another scope, and a brand the studio does not have", async () => {
    expect(await callTool(studio, "canon_get", { scope: { kind: "brand" } })).toMatchObject({ ok: false });
    expect(await callTool(studio, "canon_get", { scope: { kind: "craft", brandId: "b1" } })).toMatchObject({ ok: false });
    expect(await callTool(studio, "canon_get", { scope: { kind: "brand", brandId: "nobody" } })).toMatchObject({ ok: false });
  });

  it("gives a batch its own brand's canon, craft, performance and brand notes, and never another brand's", async () => {
    const { batchId, brand } = await batchAtTruth(studio);
    const other = await otherBrand();
    await callTool(studio, "canon_save", { text: "Show the cap.", reason: "He said so.", scope: { kind: "brand", brandId: brand.id } });
    await callTool(studio, "canon_save", { text: "Blue only.", reason: "He said so.", scope: { kind: "brand", brandId: other.id } });
    await callTool(studio, "canon_save", { text: "One light source.", reason: "Seen in checks.", scope: { kind: "craft" } });
    await callTool(studio, "brand_note", { ...rules, brandId: brand.id, note: "Show the pouch, not the bowl.", ownerSaid: "pouch pls" });
    await callTool(studio, "brand_note", { ...rules, brandId: other.id, note: "Carton from the side.", ownerSaid: "side" });

    const read = (await callTool(studio, "canon_get", { batchId })).value;
    expect(read.also.map((canon: { text: string }) => canon.text)).toEqual(["Show the cap.", "One light source."]);
    expect(read.brandNotes.map((note: { note: string }) => note.note)).toEqual(["Show the pouch, not the bowl."]);
    expect(JSON.stringify(read)).not.toMatch(/Blue only|Carton from the side/);

    const stray = await callTool(studio, "canon_get", { batchId, scope: { kind: "brand", brandId: other.id } });
    expect(stray).toEqual({ ok: false, error: expect.stringMatching(/another brand/) });
  });

  it("restores an earlier version as a new one, for the owner only", async () => {
    await callTool(studio, "canon_save", { text: "First.", reason: "Start.", scope: { kind: "craft" } });
    await callTool(studio, "canon_save", { text: "Second.", reason: "Change.", scope: { kind: "craft" } });
    const input = { version: 1, reason: "He wants the first back.", scope: { kind: "craft" } };
    expect(await callTool(studio, "canon_restore", input, member)).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });

    const restored = await callTool(studio, "canon_restore", input);
    expect(restored.value).toMatchObject({ version: 3, text: "First." });
    const versions = (await callTool(studio, "canon_versions", { scope: { kind: "craft" } })).value.versions;
    expect(versions.map((version: { version: number }) => version.version)).toEqual([3, 2, 1]);
    expect((await callTool(studio, "canon_get", { version: 2, scope: { kind: "craft" } })).value.text).toBe("Second.");
    expect(await callTool(studio, "canon_restore", { ...input, version: 9 })).toMatchObject({ ok: false });
  });
});

describe("learning records", () => {
  it("saves a record that changes no canon and no fact", async () => {
    const { batchId, brand, product } = await batchAtTruth(studio);
    const facts = await studio.services.facts.list(product.id);
    const saved = await callTool(studio, "learn", record({ kind: "brand", brandId: brand.id }, { batchId }));
    expect(saved.value).toMatchObject({ evidence: 1, scope: { kind: "brand", brandId: brand.id }, savedBy: "owner@example.com" });

    expect(await studio.services.facts.list(product.id)).toEqual(facts);
    for (const scope of [undefined, { kind: "brand", brandId: brand.id }, { kind: "craft" }, { kind: "performance" }]) {
      expect((await callTool(studio, "canon_get", scope ? { scope } : {})).value.version).toBe(0);
    }
    expect((await callTool(studio, "learning_list", { batchId })).value.records).toHaveLength(1);
  });

  it("needs the current rules", async () => {
    const { rulesVersion: _rules, ...input } = record({ kind: "craft" });
    expect(await callTool(studio, "learn", input)).toMatchObject({ ok: false });
  });

  it("keeps another brand's records out of a batch", async () => {
    const { batchId, brand } = await batchAtTruth(studio);
    const other = await otherBrand();
    await callTool(studio, "learn", record({ kind: "brand", brandId: brand.id }, { lesson: "Ours." }));
    await callTool(studio, "learn", record({ kind: "brand", brandId: other.id }, { lesson: "Theirs." }));
    await callTool(studio, "learn", record({ kind: "craft" }, { lesson: "Craft." }));

    const lessons = (await callTool(studio, "learning_list", { batchId })).value.records.map((entry: { lesson: string }) => entry.lesson);
    expect(lessons.sort()).toEqual(["Craft.", "Ours."]);
    expect(await callTool(studio, "learning_list", { batchId, scope: { kind: "brand", brandId: other.id } })).toEqual({ ok: false, error: expect.stringMatching(/another brand/) });
    expect(await callTool(studio, "learn", record({ kind: "brand", brandId: other.id }, { batchId }))).toEqual({ ok: false, error: expect.stringMatching(/another brand/) });
  });

  it("saves nothing from a test batch", async () => {
    const { batchId, brand } = await batchAtTruth(studio, { test: true });
    expect(await callTool(studio, "learn", record({ kind: "craft" }, { batchId }))).toEqual({ ok: false, error: expect.stringMatching(/test batch/) });
    expect(await callTool(studio, "brand_note", { ...rules, brandId: brand.id, note: "Show the pouch.", ownerSaid: "pouch", batchId })).toEqual({ ok: false, error: expect.stringMatching(/test batch/) });
    expect((await callTool(studio, "learning_list")).value.records).toEqual([]);
    expect((await callTool(studio, "brand_notes", { brandId: brand.id })).value.notes).toEqual([]);
  });
});

describe("canon proposals", () => {
  const propose = (scope: object, recordIds: string[], text = "The food is the picture. No prop beside it.") =>
    callTool(studio, "canon_propose", { ...rules, scope, text, reason: "He passed on every prop.", recordIds });
  const learnt = async (scope: object, extra: object = {}) => (await callTool(studio, "learn", record(scope, extra))).value.id as string;

  it("is not active until the owner says yes, and his yes makes the next version", async () => {
    const { batchId, brand } = await batchAtTruth(studio);
    const scope = { kind: "brand", brandId: brand.id };
    const made = await propose(scope, [await learnt(scope)]);
    expect(made.value).toMatchObject({ status: "proposed", baseVersion: 0 });

    expect((await callTool(studio, "canon_get", { scope })).value.version).toBe(0);
    expect((await callTool(studio, "canon_get", { batchId })).value.also).toEqual([]);

    const decide = { ...rules, id: made.value.id, approve: true, ownerSaid: "yes, no props" };
    expect(await callTool(studio, "canon_decide", decide, member)).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });
    expect((await callTool(studio, "canon_get", { scope })).value.version).toBe(0);

    const decided = await callTool(studio, "canon_decide", decide);
    expect(decided.value.proposal).toMatchObject({ status: "approved", version: 1, ownerSaid: "yes, no props" });
    expect((await callTool(studio, "canon_get", { batchId })).value.also).toMatchObject([{ version: 1, text: "The food is the picture. No prop beside it." }]);
    expect(await callTool(studio, "canon_decide", decide)).toEqual({ ok: false, error: expect.stringMatching(/already approved/) });
  });

  it("keeps a declined proposal as a record and changes nothing", async () => {
    const scope = { kind: "craft" };
    const made = await propose(scope, [await learnt(scope, { evidence: 2 })]);
    const decided = await callTool(studio, "canon_decide", { ...rules, id: made.value.id, approve: false, ownerSaid: "no, too wide" });
    expect(decided.value.proposal.status).toBe("declined");
    expect(decided.value.canon).toBeUndefined();
    expect((await callTool(studio, "canon_get", { scope })).value.version).toBe(0);
    expect((await callTool(studio, "canon_proposals")).value.proposals).toMatchObject([{ status: "declined", scopeName: expect.any(String) }]);
  });

  it("refuses one correction as a rule for every brand", async () => {
    for (const scope of [{ kind: "owner" }, { kind: "craft" }, { kind: "performance" }]) {
      expect(await propose(scope, [await learnt(scope)])).toEqual({ ok: false, error: expect.stringMatching(/One correction makes no rule/) });
    }
    const scope = { kind: "craft" };
    expect((await propose(scope, [await learnt(scope), await learnt(scope)])).ok).toBe(true);
  });

  it("refuses a record of another brand, or of another scope", async () => {
    const { brand } = await savedProduct(studio);
    const other = await otherBrand();
    const theirs = await learnt({ kind: "brand", brandId: other.id }, { evidence: 5 });
    expect(await propose({ kind: "brand", brandId: brand.id }, [theirs])).toEqual({ ok: false, error: expect.stringMatching(/A lesson stays in the scope/) });
    expect(await propose({ kind: "craft" }, [theirs])).toEqual({ ok: false, error: expect.stringMatching(/A lesson stays in the scope/) });
    expect(await propose({ kind: "craft" }, ["nothing"])).toMatchObject({ ok: false });
  });

  it("refuses a yes to a proposal written against an older canon", async () => {
    const scope = { kind: "craft" };
    const made = await propose(scope, [await learnt(scope, { evidence: 2 })]);
    await callTool(studio, "canon_save", { text: "One light source.", reason: "He said so.", scope });
    const decided = await callTool(studio, "canon_decide", { ...rules, id: made.value.id, approve: true, ownerSaid: "yes" });
    expect(decided).toEqual({ ok: false, error: expect.stringMatching(/changed since proposal/) });
    expect((await callTool(studio, "canon_get", { scope })).value.text).toBe("One light source.");
    expect((await callTool(studio, "canon_proposals", { id: made.value.id })).value).toMatchObject({ proposal: { status: "proposed" }, current: { version: 1 } });
  });
});

describe("a decision on a proposal that meets trouble", () => {
  const scope = { kind: "craft" as const };
  const evidence = async () => [(await callTool(studio, "learn", record(scope, { evidence: 2 }))).value.id as string];
  const propose = async (text: string) => (await studio.services.proposals.propose({ scope, text, reason: "Seen twice.", recordIds: await evidence(), by: "agent" })).id;
  const yes = (id: string, ownerSaid = "yes") => studio.services.proposals.decide({ id, approve: true, ownerSaid, by: "owner@example.com" });
  /** Makes the save of the decided proposal fail once, after the canon is written. */
  const failOnce = (id: string) => {
    const put = studio.table.put.bind(studio.table);
    let failed = false;
    studio.table.put = async (item, options) => {
      if (!failed && item.pk === "CANONPROPOSAL" && item.sk === `P#${id}` && item.status !== "proposed") {
        failed = true;
        throw new Error("the table is away");
      }
      return put(item, options);
    };
  };

  it("lets one of two proposals for the same canon land when both get a yes at the same moment", async () => {
    const [first, second] = [await propose("One light source."), await propose("Two props at most.")];
    const results = await Promise.allSettled([yes(first), yes(second)]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { message: expect.stringMatching(/changed since/) } });
    const canon = await studio.services.canon.get(scope);
    expect(canon.version).toBe(1);
    const all = await studio.services.proposals.list();
    expect(all.map((proposal) => proposal.status).sort()).toEqual(["approved", "proposed"]);
    expect(all.find((proposal) => proposal.status === "approved")?.text).toBe(canon.text);
    // The one that lost can be declined, or decided again after a new proposal.
    const lost = all.find((proposal) => proposal.status === "proposed")!;
    expect((await studio.services.proposals.decide({ id: lost.id, approve: false, ownerSaid: "write it again", by: "owner@example.com" })).proposal.status).toBe("declined");
  });

  it("finishes a yes that stopped after the canon was written, and does not write the canon twice", async () => {
    const id = await propose("One light source.");
    failOnce(id);
    await expect(yes(id, "yes, one light")).rejects.toThrow("the table is away");
    expect((await studio.services.canon.get(scope)).version).toBe(1);
    expect((await studio.services.proposals.get(id)).status).toBe("proposed");

    // A no cannot take back the yes that is already the canon.
    await expect(studio.services.proposals.decide({ id, approve: false, ownerSaid: "no", by: "owner@example.com" })).rejects.toThrow(/already has the owner's yes/);
    const done = await yes(id, "yes again");
    expect(done.proposal).toMatchObject({ status: "approved", version: 1, ownerSaid: "yes, one light" });
    expect((await studio.services.canon.get(scope)).version).toBe(1);
  });

  it("finishes a no that stopped before it was saved", async () => {
    const id = await propose("One light source.");
    failOnce(id);
    const no = () => studio.services.proposals.decide({ id, approve: false, ownerSaid: "not yet", by: "owner@example.com" });
    await expect(no()).rejects.toThrow("the table is away");
    expect((await no()).proposal).toMatchObject({ status: "declined", ownerSaid: "not yet" });
    expect((await studio.services.canon.get(scope)).version).toBe(0);
  });

  it("frees a yes that the canon refused, so the owner can decline it", async () => {
    const id = await propose("One light source.");
    await studio.services.canon.save({ scope, text: "Daylight only.", reason: "He said so.", by: "owner@example.com" });
    await expect(yes(id)).rejects.toThrow(/changed since proposal/);
    expect((await studio.services.proposals.decide({ id, approve: false, ownerSaid: "old", by: "owner@example.com" })).proposal.status).toBe("declined");
  });
});

describe("brand notes", () => {
  it("are the owner's to save, and stay with their brand", async () => {
    const { brand, product } = await savedProduct(studio);
    const other = await otherBrand();
    const note = { ...rules, brandId: brand.id, note: "Show the cap, not the pump.", ownerSaid: "cap not pump" };
    expect(await callTool(studio, "brand_note", note, member)).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });
    const facts = await studio.services.facts.list(product.id);
    expect((await callTool(studio, "brand_note", note)).value).toMatchObject({ brandId: brand.id, savedBy: "owner@example.com" });

    expect((await callTool(studio, "brand_notes", { brandId: brand.id })).value.notes).toHaveLength(1);
    expect((await callTool(studio, "brand_notes", { brandId: other.id })).value.notes).toEqual([]);
    expect(await studio.services.facts.list(product.id)).toEqual(facts);
    expect(await callTool(studio, "brand_note", { ...note, brandId: "nobody" })).toMatchObject({ ok: false });
  });

  it("refuses a note from a batch of another brand", async () => {
    const { batchId } = await batchAtTruth(studio);
    const other = await otherBrand();
    expect(await callTool(studio, "brand_note", { ...rules, brandId: other.id, note: "Blue only.", ownerSaid: "blue", batchId })).toEqual({ ok: false, error: expect.stringMatching(/another brand/) });
  });
});
