import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
});

describe("taste log", () => {
  it("returns a saved pick and a saved pass with the owner's words, newest first", async () => {
    const log = studio.services.tasteLog;
    await log.add({ kind: "pick", ownerSaid: "this one, the jar looks real", ideaId: "i1", draftId: "d2", savedBy: "owner@example.com" });
    studio.clock.now = new Date("2026-11-22T01:00:00Z");
    await log.add({ kind: "pass", ownerSaid: "all three look like stock photos", ideaId: "i2", savedBy: "owner@example.com" });

    const { entries } = (await callTool(studio, "taste_log")).value;
    expect(entries.map((e: { kind: string; ownerSaid: string }) => [e.kind, e.ownerSaid])).toEqual([
      ["pass", "all three look like stock photos"],
      ["pick", "this one, the jar looks real"],
    ]);
  });

  it("gives only what was said before a moment", async () => {
    await studio.services.tasteLog.add({ kind: "note", ownerSaid: "early", savedBy: "o" });
    studio.clock.now = new Date("2026-11-23T00:00:00Z");
    await studio.services.tasteLog.add({ kind: "note", ownerSaid: "late", savedBy: "o" });
    const { entries } = (await callTool(studio, "taste_log", { before: "2026-11-22T00:00:00Z" })).value;
    expect(entries.map((e: { ownerSaid: string }) => e.ownerSaid)).toEqual(["early"]);
  });

  it("saves the owner's words as a note", async () => {
    await callTool(studio, "taste_note", { ownerSaid: "less props pls", about: "kaya batch" });
    const { entries } = (await callTool(studio, "taste_log")).value;
    expect(entries[0]).toMatchObject({ kind: "note", ownerSaid: "less props pls", about: "kaya batch", savedBy: "owner@example.com" });
  });

  it("keeps one row for a copied record however often it is sent", async () => {
    const copied = { kind: "pick" as const, ownerSaid: "yes", savedBy: "o", originId: "adgen:pick:42", at: "2026-11-01T00:00:00Z" };
    await studio.services.tasteLog.add(copied);
    await studio.services.tasteLog.add(copied);
    expect(await studio.services.tasteLog.list()).toHaveLength(1);
  });
});

describe("swipe file", () => {
  it("finds saved references by every word given, newest first", async () => {
    await callTool(studio, "swipe_add", { title: "Heinz ketchup slices", why: "The bottle is the food.", source: "Leo Burnett", tags: ["food"] });
    studio.clock.now = new Date("2026-11-22T01:00:00Z");
    await callTool(studio, "swipe_add", { title: "Lego shadow", why: "A brick casts the shadow of a ship.", source: "Blattner Brunner" });

    const all = (await callTool(studio, "swipe_search")).value.items;
    expect(all.map((i: { title: string }) => i.title)).toEqual(["Lego shadow", "Heinz ketchup slices"]);
    const found = (await callTool(studio, "swipe_search", { words: "bottle FOOD" })).value.items;
    expect(found.map((i: { title: string }) => i.title)).toEqual(["Heinz ketchup slices"]);
    expect((await callTool(studio, "swipe_search", { words: "nothing here" })).value.items).toEqual([]);
  });
});
