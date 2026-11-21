import { beforeEach, describe, expect, it } from "vitest";
import { CanonStore } from "../../src/taste/canon.js";
import { savedProduct } from "../helpers/batch.js";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { MemoryTable } from "../helpers/memory-table.js";

/** A table whose second raise of the canon's count fails, as when a save stops between its two writes. */
class StopsAfterVersion extends MemoryTable {
  private raises = 0;
  override async add(...args: Parameters<MemoryTable["add"]>) {
    if (args[1] === "COUNT" && ++this.raises === 2) throw new Error("stopped");
    return super.add(...args);
  }
}

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

describe("taste canon", () => {
  it("is version 0 with no text before the owner writes one", async () => {
    expect((await callTool(studio, "canon_get")).value).toMatchObject({ version: 0, text: "" });
  });

  it("refuses a save without a reason", async () => {
    const saved = await callTool(studio, "canon_save", { text: "One clever object.", reason: "  " });
    expect(saved).toEqual({ ok: false, error: expect.stringMatching(/needs a reason/) });
    expect((await callTool(studio, "canon_get")).value.version).toBe(0);
  });

  it("makes a new version on each save and keeps the old one readable", async () => {
    await callTool(studio, "canon_save", { text: "One clever object.", reason: "First canon." });
    studio.clock.now = new Date("2026-11-22T01:00:00Z");
    const second = await callTool(studio, "canon_save", { text: "One clever object. No clutter.", reason: "He passed on a busy draft." });
    expect(second.value).toMatchObject({ version: 2, savedBy: "owner@example.com", reason: "He passed on a busy draft." });

    expect((await callTool(studio, "canon_get")).value.text).toBe("One clever object. No clutter.");
    expect((await callTool(studio, "canon_get", { version: 1 })).value.text).toBe("One clever object.");
    const versions = (await callTool(studio, "canon_versions")).value.versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0]).not.toHaveProperty("text");
  });

  it("gives two saves at the same moment their own versions", async () => {
    const canon = studio.services.canon;
    const saved = await Promise.all(["a", "b", "c"].map((text) => canon.save({ text, reason: `Save ${text}.`, by: "o" })));
    expect(saved.map((version) => version.version).sort()).toEqual([1, 2, 3]);
    expect((await canon.get()).version).toBe(3);
    expect((await canon.versions()).map((version) => version.reason).sort()).toEqual(["Save a.", "Save b.", "Save c."]);
  });

  it("reads the newest version when a save stopped before the count was raised", async () => {
    const canon = new CanonStore(new StopsAfterVersion(), () => new Date("2026-11-22T03:00:00Z"));
    await canon.save({ text: "First.", reason: "Start.", by: "o" });
    await expect(canon.save({ text: "Second.", reason: "Change.", by: "o" })).rejects.toThrow("stopped");
    expect(await canon.get()).toMatchObject({ version: 2, text: "Second." });
    expect(await canon.save({ text: "Third.", reason: "Change again.", by: "o" })).toMatchObject({ version: 3 });
    expect(await canon.get()).toMatchObject({ version: 3, text: "Third." });
  });

  it("lets only the owner change the canon", async () => {
    const saved = await callTool(studio, "canon_save", { text: "Mine now.", reason: "Because." }, { sub: "sub-member" });
    expect(saved).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });
  });

  it("records each read of the taste on the batch it was read for", async () => {
    const { brand, product } = await savedProduct(studio);
    const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id });
    const b1 = made.value.batch.id as string;
    expect(await studio.services.reads.missing(b1, "v1")).toEqual(["canon_get", "taste_log", "swipe_search"]);
    await callTool(studio, "canon_get", { batchId: b1 });
    expect(await studio.services.reads.missing(b1, "v1")).toEqual(["taste_log", "swipe_search"]);
    await callTool(studio, "taste_log", { batchId: b1 });
    await callTool(studio, "swipe_search", { batchId: b1 });
    expect(await studio.services.reads.missing(b1, "v1")).toEqual([]);
    expect(await studio.services.reads.missing("b2", "v1")).toHaveLength(3);
  });

  it("does not count a read of an old version, or of a batch that does not exist, as reading the canon", async () => {
    const { batchId } = await batchAtTruthUnread();
    await callTool(studio, "canon_save", { text: "One clever object.", reason: "First canon." });
    await callTool(studio, "canon_get", { batchId, version: 1 });
    expect(await studio.services.reads.missing(batchId, "v1")).toContain("canon_get");
    expect(await callTool(studio, "canon_get", { batchId: "nothing" })).toMatchObject({ ok: false });
    expect(await studio.services.reads.missing("nothing", "v1")).toContain("canon_get");
  });
});

async function batchAtTruthUnread() {
  const { brand, product } = await savedProduct(studio);
  const made = await callTool(studio, "batch_create", { kind: "v1", brandId: brand.id, productId: product.id });
  return { batchId: made.value.batch.id as string };
}
