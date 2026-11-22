import { beforeEach, describe, expect, it } from "vitest";
import { address, loadRows, numbers } from "../../src/outreach/load.js";
import { stageOf } from "../../src/outreach/stage.js";
import { OutreachStore } from "../../src/outreach/store.js";
import { MemoryTable } from "../helpers/memory-table.js";
import { row } from "./helpers.js";

let store: OutreachStore;
const clock = { now: new Date("2026-11-23T02:00:00Z") };
const now = () => clock.now;

beforeEach(() => {
  store = new OutreachStore(new MemoryTable(), now);
});

describe("the load of the list", () => {
  it("gives a loaded row back with every field", async () => {
    const full = row(7, { bestRoute: "WhatsApp", secondRoute: "Email", phone: "+65 6000 0007", instagram: "brand7", decisionMaker: "A Person", dmTitle: "Founder", linkedin: "https://www.linkedin.com/in/a-person" });
    expect(await loadRows(store, [full], now)).toEqual({ added: 1, updated: 0, refused: [] });
    expect(await store.get("00007")).toEqual({
      id: "00007",
      n: 7,
      brand: "Brand 7",
      sector: "F&B",
      liveAds: 24,
      tier: "20+",
      newestAd: "2026-11-01",
      bestRoute: "WhatsApp",
      secondRoute: "Email",
      whatsapp: ["6580000007"],
      email: "hello@brand7.example",
      phone: "+65 6000 0007",
      instagram: "brand7",
      decisionMaker: "A Person",
      dmTitle: "Founder",
      linkedin: "https://www.linkedin.com/in/a-person",
      loadedAt: "2026-11-23T02:00:00.000Z",
    });
  });

  it("updates the list's fields on a second load and keeps the events, the ad and the note", async () => {
    await loadRows(store, [row(1)], now);
    await store.addEvent("00001", { type: "note", text: "Likes yellow." }, "owner");
    await store.addEvent("00001", { type: "kind", kind: "product" }, "agent");
    await store.addAd("00001", { batchId: "b", imageId: "i", kind: "v1", key: "k", why: "w" });
    expect(await loadRows(store, [row(1, { liveAds: "31", tier: "5-19 live ads", email: undefined })], now)).toEqual({ added: 0, updated: 1, refused: [] });
    const [file] = await store.all();
    expect(file!.profile).toMatchObject({ liveAds: 31, tier: "5-19" });
    expect(file!.profile.email).toBeUndefined();
    expect(file).toMatchObject({ ads: [{ n: 1 }], events: [{ type: "note" }, { type: "kind" }] });
  });

  it("leaves an opt-out in place", async () => {
    await loadRows(store, [row(1)], now);
    await store.addEvent("00001", { type: "optout" }, "owner");
    await store.addOptOut(await store.get("00001"));
    await loadRows(store, [row(1, { whatsapp: "+65 8111 1111" })], now);
    const [file] = await store.all();
    expect(stageOf(file!, await store.optOuts())).toBe("opted_out");
    // The old number stays off the lists, and the new one joins it.
    expect(await store.optOuts()).toEqual(new Set(["W#6580000001", "W#6581111111", "E#hello@brand1.example"]));
  });

  it("takes a contact that a second load gives to an opted-out brand off the lists for every brand", async () => {
    await loadRows(store, [row(1), row(2)], now);
    await store.addEvent("00001", { type: "optout" }, "owner");
    await store.addOptOut(await store.get("00001"));
    const stages = async () => Promise.all((await store.all()).map(async (file) => stageOf(file, await store.optOuts())));
    expect(await stages()).toEqual(["opted_out", "new"]);
    // The list now says that brand 1 is reached at brand 2's number too.
    await loadRows(store, [row(1, { whatsapp: "+65 8000 0001; +65 8000 0002" })], now);
    expect(await stages()).toEqual(["opted_out", "opted_out"]);
  });

  it("refuses a row with a number that is not a number or an address that is not one, by its row and field, and saves the others", async () => {
    const result = await loadRows(store, [row(1), row(2, { whatsapp: "call the shop" }), row(3, { email: "not an address" }), row(4, { tier: "huge" }), row(5, { liveAds: "many" }), row(6, { newestAd: "last week" }), row(7)], now);
    expect(result).toMatchObject({ added: 2, updated: 0 });
    expect(result.refused.map(({ row: n, field }) => [n, field])).toEqual([
      [2, "whatsapp"],
      [3, "email"],
      [4, "tier"],
      [5, "liveAds"],
      [6, "newestAd"],
    ]);
    // A refusal names the row and the field. It never repeats the value.
    expect(JSON.stringify(result.refused)).not.toMatch(/call the shop|not an address/);
    expect((await store.all()).map((file) => file.profile.n)).toEqual([1, 7]);
  });

  it("refuses a row whose number is saved under another brand", async () => {
    await loadRows(store, [row(1)], now);
    const result = await loadRows(store, [row(1, { brand: "Another Brand" })], now);
    expect(result).toEqual({ added: 0, updated: 0, refused: [{ row: 1, field: "brand", why: expect.stringMatching(/number 1 is saved as "Brand 1"/) }] });
    // The same name in other letters is the same brand.
    expect(await loadRows(store, [row(1, { brand: "brand 1" })], now)).toMatchObject({ updated: 1, refused: [] });
  });

  it("refuses a number that is in the rows twice", async () => {
    const result = await loadRows(store, [row(1), row(1)], now);
    expect(result).toMatchObject({ added: 1, refused: [{ row: 1, field: "n" }] });
  });
});

describe("a number and an address of the list", () => {
  it("reads one number, several numbers, and a local number", () => {
    expect(numbers("+6580000001")).toEqual(["6580000001"]);
    expect(numbers("+65 8000 0001; +6590000002")).toEqual(["6580000001", "6590000002"]);
    expect(numbers("80000001 90000002")).toEqual(["6580000001", "6590000002"]);
    expect(numbers("6580000001")).toEqual(["6580000001"]);
    expect(numbers("+60 12-345 6789")).toEqual(["60123456789"]);
    expect(numbers("+6580000001; +65 8000 0001")).toEqual(["6580000001"]);
    expect(numbers(undefined)).toEqual([]);
    expect(numbers("  ")).toEqual([]);
  });

  it("refuses what is not a number", () => {
    expect(() => numbers("8000")).toThrow(/length/);
    expect(() => numbers("+65 8000 000x")).toThrow(/not a number/);
    expect(() => numbers("https://wa.me/6580000001")).toThrow();
  });

  it("puts an address in lower case and refuses what is not one", () => {
    expect(address(" Hello@Brand.Example ")).toBe("hello@brand.example");
    expect(address(undefined)).toBeUndefined();
    for (const bad of ["hello", "a@b", "a b@c.example", "a@b.example?subject=x", "a@b.example,c@d.example", "<a@b.example>"]) expect(() => address(bad)).toThrow(/not an email address/);
  });
});
