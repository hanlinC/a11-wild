import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

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

  it("lets only the owner change the canon", async () => {
    const saved = await callTool(studio, "canon_save", { text: "Mine now.", reason: "Because." }, { sub: "sub-member" });
    expect(saved).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });
  });

  it("records each read of the taste on the batch it was read for", async () => {
    expect(await studio.services.reads.missing("b1")).toEqual(["canon_get", "taste_log", "swipe_search"]);
    await callTool(studio, "canon_get", { batchId: "b1" });
    expect(await studio.services.reads.missing("b1")).toEqual(["taste_log", "swipe_search"]);
    await callTool(studio, "taste_log", { batchId: "b1" });
    await callTool(studio, "swipe_search", { batchId: "b1" });
    expect(await studio.services.reads.missing("b1")).toEqual([]);
    expect(await studio.services.reads.missing("b2")).toHaveLength(3);
  });

  it("does not count a read of an old version as reading the canon", async () => {
    await callTool(studio, "canon_save", { text: "One clever object.", reason: "First canon." });
    await callTool(studio, "canon_get", { batchId: "b1", version: 1 });
    expect(await studio.services.reads.missing("b1")).toContain("canon_get");
  });
});
