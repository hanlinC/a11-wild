import { beforeEach, describe, expect, it } from "vitest";
import { loadRows, makeTestProspect } from "../../src/outreach/load.js";
import { OutreachSequence } from "../../src/outreach/sequence.js";
import { OutreachStore } from "../../src/outreach/store.js";
import { todayPage } from "../../src/outreach/today.js";
import { MemoryTable } from "../helpers/memory-table.js";
import { row } from "./helpers.js";

type Step = { titles: [string, string]; body: string };
const STEPS: [Step, Step, Step] = [
  { titles: ["New ad for {Brand}", "{Brand}, I made this for you"], body: "Hi, I made this ad for {Brand}." },
  { titles: ["Re: New ad for {Brand}", "{Brand}, still yours"], body: "Hi, Han again." },
  { titles: ["Last one, {Brand}", "{Brand}, one more before I go"], body: "Hi, last note from me." },
];

let store: OutreachStore;
let sequence: OutreachSequence;
const clock = { now: new Date() };
const now = () => clock.now;
const at = (singaporeTime: string) => {
  clock.now = new Date(`${singaporeTime}+08:00`);
};
const today = () => todayPage({ store, sequence, pictures: { viewUrl: async (key) => `https://pictures.example/${key}?signed`, downloadUrl: async (key, name) => `https://pictures.example/${key}?save=${name}` }, now });
const adOf = { batchId: "b", imageId: "i", kind: "v1" as const, key: "outreach/ad.png", why: "The pack on its colour." };
async function ready(id: string) {
  const ad = await store.addAd(id, adOf);
  await sequence.verdict(id, { ad: ad.n, yes: true });
}
const brands = (lines: { prospect: { brand: string } }[]) => lines.map((line) => line.prospect.brand);

beforeEach(async () => {
  at("2026-11-23T10:00:00");
  store = new OutreachStore(new MemoryTable(), now);
  sequence = new OutreachSequence(store, now);
  await loadRows(store, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(n)), now);
  await sequence.saveTemplates(STEPS);
});

describe("the Today page", () => {
  it("is empty with nothing to do, and names the day", async () => {
    expect(await today()).toEqual({ day: "2026-11-23", sendingDay: true, nextSendingDay: "2026-11-24", daily: 5, firstsSent: 0, templates: true, owed: [], followUps: [], firsts: [], adsWaiting: [], picks: [] });
  });

  it("shows an attached ad that waits for a yes or a no, with its picture, and no message", async () => {
    await store.addAd("00003", adOf);
    const page = await today();
    expect(brands(page.adsWaiting)).toEqual(["Brand 3"]);
    expect(page.adsWaiting[0]).toMatchObject({ prospect: { stage: "ad_waits", adWaits: true }, ad: { n: 1, why: "The pack on its colour.", viewUrl: "https://pictures.example/outreach/ad.png?signed" } });
    expect(page.adsWaiting[0]!.messages).toBeUndefined();
    expect(page.firsts).toEqual([]);
  });

  it("offers the ready brands in list order with the ad and both versions of the first message", async () => {
    for (const id of ["00005", "00002"]) await ready(id);
    const page = await today();
    expect(brands(page.firsts)).toEqual(["Brand 2", "Brand 5"]);
    expect(page.firsts[0]).toMatchObject({
      step: 0,
      ad: { n: 1, verdict: "yes" },
      messages: [
        { title: "New ad for Brand 2", text: "Hi, I made this ad for Brand 2.", href: expect.stringMatching(/^https:\/\/wa\.me\/6580000002\?text=New%20ad/) },
        { title: "Brand 2, I made this for you" },
      ],
    });
  });

  it("offers two new brands when three of the five first messages are sent", async () => {
    for (const id of ["00001", "00002", "00003", "00004", "00005", "00006"]) await ready(id);
    for (const id of ["00001", "00002", "00003"]) await sequence.send(id, { step: 0, title: 0 });
    const page = await today();
    expect(page).toMatchObject({ daily: 5, firstsSent: 3 });
    expect(brands(page.firsts)).toEqual(["Brand 4", "Brand 5"]);
  });

  it("offers no first message when the day's number is sent, and still shows a follow-up that is due", async () => {
    await ready("00001");
    await sequence.send("00001", { step: 0, title: 0 });
    at("2026-11-26T10:00:00");
    await sequence.setDaily(2);
    for (const id of ["00002", "00003", "00004"]) await ready(id);
    for (const id of ["00002", "00003"]) await sequence.send(id, { step: 0, title: 0 });
    const page = await today();
    expect(page.firsts).toEqual([]);
    expect(page.followUps).toMatchObject([{ prospect: { brand: "Brand 1", next: { step: 1, due: "2026-11-26" } }, step: 1, messages: [{ title: "Re: New ad for Brand 1" }, { title: "Brand 1, still yours" }] }]);
  });

  it("shows a follow-up from its day, and follow-up 2 four days after follow-up 1", async () => {
    await ready("00001");
    await sequence.send("00001", { step: 0, title: 0 });
    at("2026-11-25T10:00:00");
    expect((await today()).followUps).toEqual([]);
    at("2026-11-27T10:00:00");
    expect(brands((await today()).followUps)).toEqual(["Brand 1"]);
    await sequence.send("00001", { step: 1, title: 0 });
    expect((await today()).followUps).toEqual([]);
    at("2026-12-01T10:00:00");
    expect((await today()).followUps).toMatchObject([{ step: 2, messages: [{ title: "Last one, Brand 1" }, {}] }]);
    await sequence.send("00001", { step: 2, title: 0 });
    expect((await today()).followUps).toEqual([]);
  });

  it("puts a more reply first until the owner logs his answer", async () => {
    for (const id of ["00001", "00002"]) await ready(id);
    await sequence.send("00002", { step: 0, title: 0 });
    await sequence.reply("00002", { reply: "more", text: "Show me another." });
    let page = await today();
    expect(page.owed).toMatchObject([{ prospect: { brand: "Brand 2", stage: "replied" }, reply: { text: "Show me another." }, ad: { n: 1 } }]);
    expect(page.followUps).toEqual([]);
    await sequence.answered("00002");
    page = await today();
    expect(page.owed).toEqual([]);
  });

  it("leaves a reply that is not more out of the owed answers", async () => {
    await ready("00001");
    await sequence.send("00001", { step: 0, title: 0 });
    await sequence.reply("00001", { reply: "other", text: "Who is this?" });
    expect((await today()).owed).toEqual([]);
  });

  it("offers the first of two ready brands with the same number, and the second after the owner chooses it", async () => {
    await loadRows(store, [row(2, { whatsapp: "+65 8000 0001" })], now);
    for (const id of ["00001", "00002"]) await ready(id);
    expect(brands((await today()).firsts)).toEqual(["Brand 1"]);
    await sequence.choose("00002");
    expect(brands((await today()).firsts)).toEqual(["Brand 1", "Brand 2"]);
  });

  it("shows nothing of an opted-out brand, also when the opt-out came from a brand with the same contact", async () => {
    await loadRows(store, [row(2, { whatsapp: "+65 8000 0001" })], now);
    for (const id of ["00001", "00002", "00003"]) await ready(id);
    await store.addAd("00002", adOf);
    await sequence.optOut("00001");
    const page = await today();
    expect(brands(page.firsts)).toEqual(["Brand 3"]);
    expect(page.adsWaiting).toEqual([]);
  });

  it("says that a Saturday is not a planned day, with the next one, and shows the same lists: the owner can send on any day", async () => {
    for (const id of ["00001", "00002", "00004"]) await ready(id);
    await sequence.send("00001", { step: 0, title: 0 });
    await sequence.reply("00001", { reply: "more" });
    await sequence.send("00004", { step: 0, title: 0 });
    await store.addAd("00003", adOf);
    at("2026-11-28T10:00:00");
    const page = await today();
    expect(page).toMatchObject({ day: "2026-11-28", sendingDay: false, nextSendingDay: "2026-11-30", firstsSent: 0 });
    expect(brands(page.owed)).toEqual(["Brand 1"]);
    expect(brands(page.adsWaiting)).toEqual(["Brand 3"]);
    // The follow-up that was due on Thursday is still due, and the brand that is ready can get its first message.
    expect(brands(page.followUps)).toEqual(["Brand 4"]);
    expect(brands(page.firsts)).toEqual(["Brand 2"]);
  });

  it("offers a test prospect without taking a place of the day", async () => {
    await sequence.setDaily(1);
    const test = await makeTestProspect(store, { brand: "TEST prospect", whatsapp: "+65 8999 0000" }, now);
    for (const id of ["00001", test.id]) await ready(id);
    expect(brands((await today()).firsts).sort()).toEqual(["Brand 1", "TEST prospect"]);
  });

  it("gives no message before the owner's text is loaded", async () => {
    store = new OutreachStore(new MemoryTable(), now);
    sequence = new OutreachSequence(store, now);
    await loadRows(store, [row(1)], now);
    await ready("00001");
    const page = await today();
    expect(page.templates).toBe(false);
    expect(page.firsts[0]!.messages).toBeUndefined();
  });
});
