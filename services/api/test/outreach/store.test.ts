import { beforeEach, describe, expect, it } from "vitest";
import { loadRows, makeTestProspect } from "../../src/outreach/load.js";
import { stageOf } from "../../src/outreach/stage.js";
import { OutreachStore } from "../../src/outreach/store.js";
import { MemoryTable } from "../helpers/memory-table.js";
import { row } from "./helpers.js";

let table: MemoryTable;
let store: OutreachStore;
const now = () => new Date("2026-11-23T02:00:00Z");

beforeEach(() => {
  table = new MemoryTable();
  store = new OutreachStore(table, now);
});

describe("the outreach store", () => {
  it("gives every prospect in list order with its ads, sends and events", async () => {
    await loadRows(store, [row(12), row(2), row(101)], now);
    await store.addEvent("00002", { type: "note", text: "Met at a fair." }, "owner");
    await store.addAd("00002", { batchId: "b", imageId: "i", kind: "v1", key: "outreach/00002/1.png", why: "The pack." });
    await store.putSend("00002", { step: 0, day: "2026-11-23", channel: "whatsapp", title: "t", text: "x", at: now().toISOString() });
    const files = await store.all();
    expect(files.map((file) => file.profile.n)).toEqual([2, 12, 101]);
    expect(files[0]).toMatchObject({ ads: [{ n: 1, batchId: "b" }], sends: [{ step: 0 }], events: [{ type: "note", by: "owner" }] });
    expect(files[1]).toMatchObject({ ads: [], sends: [], events: [] });
  });

  it("keeps two events saved at the same moment", async () => {
    await loadRows(store, [row(1)], now);
    await Promise.all([store.addEvent("00001", { type: "note", text: "one" }, "owner"), store.addEvent("00001", { type: "note", text: "two" }, "agent")]);
    expect((await store.all())[0]!.events).toHaveLength(2);
  });

  it("numbers the ads of a prospect one after the other", async () => {
    await loadRows(store, [row(1)], now);
    const adOf = { batchId: "b", imageId: "i", kind: "v1" as const, key: "k", why: "w" };
    expect((await store.addAd("00001", adOf)).n).toBe(1);
    expect((await store.addAd("00001", adOf)).n).toBe(2);
  });

  it("saves a step of the sequence once, and takes it back only on its own day", async () => {
    await loadRows(store, [row(1)], now);
    const sent = { step: 0 as const, day: "2026-11-23", channel: "whatsapp" as const, title: "t", text: "x", at: now().toISOString() };
    expect(await store.putSend("00001", sent)).toBe(true);
    expect(await store.putSend("00001", sent)).toBe(false);
    expect(await store.deleteSend("00001", 0, "2026-11-24")).toBe(false);
    expect(await store.deleteSend("00001", 0, "2026-11-23")).toBe(true);
    expect((await store.all())[0]!.sends).toEqual([]);
  });

  it("counts the first messages of a day up to the ceiling and gives a place back", async () => {
    expect(await store.takePlace("2026-11-23", 2)).toBe(true);
    expect(await store.takePlace("2026-11-23", 2)).toBe(true);
    expect(await store.takePlace("2026-11-23", 2)).toBe(false);
    await store.givePlace("2026-11-23");
    expect(await store.placesTaken("2026-11-23")).toBe(1);
    expect(await store.placesTaken("2026-11-24")).toBe(0);
  });

  it("keeps an opt-out for the contact: a second brand with the same number, or the same address in other letters, is opted out", async () => {
    await loadRows(store, [row(1), row(2, { whatsapp: "+65 8000 0001", email: "other@brand2.example" }), row(3, { whatsapp: undefined, email: "Hello@Brand1.Example" }), row(4)], now);
    await store.addEvent("00001", { type: "optout" }, "owner");
    await store.addOptOut(await store.get("00001"));
    const optOuts = await store.optOuts();
    const stages = Object.fromEntries((await store.all()).map((file) => [file.profile.n, stageOf(file, optOuts)]));
    expect(stages).toEqual({ 1: "opted_out", 2: "opted_out", 3: "opted_out", 4: "new" });
  });

  it("removes a test prospect with all its items, and refuses for a prospect of the list", async () => {
    await loadRows(store, [row(1)], now);
    await store.addEvent("00001", { type: "note", text: "kept" }, "owner");
    const test = await makeTestProspect(store, { brand: "TEST prospect", whatsapp: "+65 8000 0001" }, now);
    await store.addEvent(test.id, { type: "optout" }, "owner");
    await store.addAd(test.id, { batchId: "b", imageId: "i", kind: "v1", key: "k", why: "w" });
    await store.putSend(test.id, { step: 0, day: "2026-11-23", channel: "whatsapp", title: "t", text: "x", at: now().toISOString() });
    const before = table.items.size;
    expect(await store.removeTest(test.id)).toBe(4);
    expect(table.items.size).toBe(before - 4);
    await expect(store.removeTest("00001")).rejects.toThrow(/Only a test prospect can be removed/);
    expect((await store.all()).map((file) => file.profile.id)).toEqual(["00001"]);
    // The test's opt-out wrote nothing to the register, so the brand with the same number is still free.
    expect((await store.optOuts()).size).toBe(0);
  });

  it("keeps a setting, and writes a first value only once when asked", async () => {
    expect(await store.setting("DAILY")).toBeUndefined();
    expect(await store.saveSetting("DAILY", 5, { ifNotExists: true })).toBe(true);
    expect(await store.saveSetting("DAILY", 9, { ifNotExists: true })).toBe(false);
    expect(await store.setting("DAILY")).toBe(5);
  });
});
