import { beforeEach, describe, expect, it, vi } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { approvedClient, callTool, config, createStudio, json, ORIGIN, sessionCookie, type Studio } from "../helpers/deps.js";
import { outreachBatch } from "../helpers/outreach-batch.js";
import { JPEG, PNG } from "../helpers/pictures.js";
import { loadProspects, row } from "../outreach/helpers.js";

let studio: Studio;
let cookie: string;
const outreach = () => studio.services.outreach;
const TEMPLATES = [
  { titles: ["New ad for {Brand}", "{Brand}, I made this for you"], body: "Hi, I made this ad for {Brand}." },
  { titles: ["Re: New ad for {Brand}", "{Brand}, still yours"], body: "Hi, Han again." },
  { titles: ["Last one, {Brand}", "{Brand}, one more before I go"], body: "Hi, last note from me." },
];
const AD = { batchId: "b", imageId: "i", kind: "v1" as const, key: "outreach/x/1.png", why: "The pack on its colour." };

const get = (path: string, headers: Record<string, string> = { cookie }) => studio.app.request(path, { headers });
const post = (path: string, body: unknown = {}, as = cookie, origin: string | null = ORIGIN) =>
  studio.app.request(path, { method: "POST", headers: { cookie: as, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
/** One write on a prospect. The clock moves a second after it, so each event has its own time. */
const on = async (id: string, action: string, body: unknown = {}) => {
  const response = await post(`/api/outreach/prospects/${id}/${action}`, body);
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  return response;
};

const UPLOAD = "3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b";
/** Every outreach route, with a body that would pass. */
const READS = ["/api/outreach/today", "/api/outreach/prospects", "/api/outreach/prospects/00001", "/api/outreach/templates"];
const WRITES: [string, unknown][] = [
  ["/api/outreach/prospects/00001/ad", { ad: 1, yes: true }],
  ["/api/outreach/prospects/00001/sent", { step: 0, title: 0 }],
  ["/api/outreach/prospects/00001/unsent", { step: 0 }],
  ["/api/outreach/prospects/00001/reply", { reply: "other" }],
  ["/api/outreach/prospects/00001/answered", {}],
  ["/api/outreach/prospects/00001/optout", {}],
  ["/api/outreach/prospects/00001/stage", { stage: "lost" }],
  ["/api/outreach/prospects/00001/note", { text: "A note." }],
  ["/api/outreach/prospects/00001/channel", { channel: "email" }],
  ["/api/outreach/prospects/00001/kind", { kind: "service" }],
  ["/api/outreach/prospects/00001/choose", {}],
  ["/api/outreach/prospects/00001/remove", {}],
  ["/api/outreach/prospects/00001/picture", { type: "image/png", bytes: 12 }],
  [`/api/outreach/prospects/00001/picture/${UPLOAD}/done`, {}],
  ["/api/outreach/prospects/00001/pick", { imageId: "image-1" }],
  ["/api/outreach/prospects/00001/none", { ownerSaid: "The headline says nothing." }],
  ["/api/outreach/prospects/00001/words", { imageId: "image-1", ownerSaid: "Say the price." }],
  ["/api/outreach/templates", { steps: TEMPLATES }],
  ["/api/outreach/daily", { daily: 9 }],
  ["/api/outreach/test-prospect", {}],
];

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  // A Monday morning in Singapore.
  studio.clock.now = new Date("2026-11-23T02:00:00Z");
  cookie = await sessionCookie(studio);
});

/** One brand with an ad the owner said yes to, and the message text loaded. */
async function ready(rows = [row(1)]) {
  const ids = await loadProspects(studio, rows);
  await outreach().sequence.saveTemplates(TEMPLATES as never);
  for (const id of ids) {
    await outreach().store.addAd(id, AD);
    await outreach().sequence.verdict(id, { ad: 1, yes: true });
  }
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
}

describe("who may open the outreach routes", () => {
  it("answers 401 with no session, for every read and every write, and changes nothing", async () => {
    await loadProspects(studio);
    for (const path of READS) expect((await get(path, {})).status, path).toBe(401);
    for (const [path, body] of WRITES) expect((await post(path, body, "")).status, path).toBe(401);
    expect((await outreach().store.all())[0]!.events).toEqual([]);
  });

  it("refuses a member, for every read and every write", async () => {
    await loadProspects(studio);
    const member = await sessionCookie(studio, "member");
    for (const path of READS) {
      const response = await get(path, { cookie: member });
      expect(response.status, path).toBe(403);
      expect(await json(response)).toEqual({ error: "owner_only" });
    }
    for (const [path, body] of WRITES) expect((await post(path, body, member)).status, path).toBe(403);
    expect(await outreach().store.all()).toHaveLength(1);
    expect((await outreach().store.all())[0]!.events).toEqual([]);
  });

  it("refuses an MCP access token: only a dashboard session opens them", async () => {
    await loadProspects(studio);
    const bearer = { authorization: `Bearer ${await studio.signer.accessToken(config)}` };
    for (const path of READS) expect((await get(path, bearer)).status, path).toBe(401);
    for (const [path, body] of WRITES) {
      const response = await studio.app.request(path, { method: "POST", headers: { ...bearer, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status, path).toBe(401);
    }
  });

  it("refuses a write from another origin, and one with no origin", async () => {
    await loadProspects(studio);
    for (const [path, body] of WRITES) {
      expect((await post(path, body, cookie, "https://evil.example")).status, path).toBe(403);
      expect((await post(path, body, cookie, null)).status, path).toBe(403);
    }
    expect((await outreach().store.all())[0]!.events).toEqual([]);
  });

  it("refuses an unknown field in every body", async () => {
    await ready();
    for (const [path, body] of WRITES) {
      const response = await post(path, { ...(body as object), extra: 1 });
      expect(response.status, path).toBe(400);
      expect((await json(response)).error, path).toBe("bad_request");
    }
    expect((await outreach().store.all())[0]!.events).toHaveLength(1);
  });
});

describe("the owner's day", () => {
  it("shows the first message of a ready brand with both titles, the link and the ad to save", async () => {
    await ready();
    const page = await json(await get("/api/outreach/today"));
    expect(page).toMatchObject({ day: "2026-11-23", sendingDay: true, daily: 5, firstsSent: 0, templates: true, owed: [], followUps: [], adsWaiting: [] });
    expect(page.firsts).toHaveLength(1);
    expect(page.firsts[0]).toMatchObject({
      prospect: { id: "00001", brand: "Brand 1", stage: "ready", channel: "whatsapp" },
      step: 0,
      ad: { n: 1, viewUrl: expect.stringContaining("outreach/x/1.png"), downloadUrl: expect.stringContaining("download=Brand%201-ad-1.png") },
      messages: [
        { title: "New ad for Brand 1", href: expect.stringMatching(/^https:\/\/wa\.me\/6580000001\?text=/) },
        { title: "Brand 1, I made this for you", text: "Hi, I made this ad for Brand 1." },
      ],
    });
  });

  it("offers the message on the brand's own page on a Saturday too, and takes the mark", async () => {
    await ready();
    // Saturday 28 November 2026, 10:00 in Singapore.
    studio.clock.now = new Date("2026-11-28T02:00:00Z");
    cookie = await sessionCookie(studio);
    const page = await json(await get("/api/outreach/prospects/00001"));
    expect(page.prospect.stage).toBe("ready");
    expect(page.message).toMatchObject({ step: 0 });
    const marked = await post("/api/outreach/prospects/00001/sent", { step: 0, title: 0 });
    expect(marked.status).toBe(200);
    expect((await json(await get("/api/outreach/prospects/00001"))).prospect.stage).toBe("contacted");
  });

  it("marks a message as sent once, with the title he used, and takes it back on the same day only", async () => {
    await ready();
    const sent = await json(await on("00001", "sent", { step: 0, title: 1 }));
    expect(sent).toMatchObject({ prospect: { stage: "contacted", next: { step: 1, due: "2026-11-26" } }, sends: [{ step: 0, day: "2026-11-23", channel: "whatsapp", title: "Brand 1, I made this for you", text: "Hi, I made this ad for Brand 1." }] });
    await on("00001", "sent", { step: 0, title: 0 });
    expect((await outreach().store.all())[0]!.sends).toHaveLength(1);
    expect((await json(await get("/api/outreach/today"))).firstsSent).toBe(1);
    expect((await json(await on("00001", "unsent", { step: 0 }))).prospect.stage).toBe("ready");
    expect((await json(await get("/api/outreach/today"))).firstsSent).toBe(0);
    await on("00001", "sent", { step: 0, title: 0 });
    studio.clock.now = new Date("2026-11-24T02:00:00Z");
    cookie = await sessionCookie(studio);
    const late = await on("00001", "unsent", { step: 0 });
    expect(late.status).toBe(400);
    expect((await json(late)).message).toMatch(/on its own day only/);
  });

  it("refuses a first message above the day's number", async () => {
    await ready([row(1), row(2)]);
    expect((await post("/api/outreach/daily", { daily: 1 })).status).toBe(200);
    expect((await post("/api/outreach/daily", { daily: 21 })).status).toBe(400);
    expect((await on("00001", "sent", { step: 0, title: 0 })).status).toBe(200);
    const second = await on("00002", "sent", { step: 0, title: 0 });
    expect(second.status).toBe(400);
    expect((await json(second)).message).toMatch(/Today's 1 first messages are sent/);
  });

  it("refuses a no to an ad without his words, and takes one with them", async () => {
    await loadProspects(studio);
    await outreach().store.addAd("00001", AD);
    const bare = await on("00001", "ad", { ad: 1, yes: false });
    expect(bare.status).toBe(400);
    expect((await json(bare)).message).toMatch(/A no needs your words/);
    const no = await json(await on("00001", "ad", { ad: 1, yes: false, ownerSaid: "The pack is too small." }));
    expect(no).toMatchObject({ prospect: { stage: "new", adWaits: false }, ads: [{ n: 1, verdict: "no" }] });
    expect((await on("00001", "ad", { ad: 1, yes: true })).status).toBe(400);
  });

  it("logs a reply: more is owed an answer, no is an opt-out for every brand of that contact", async () => {
    await ready([row(1), row(2), row(3, { whatsapp: "+65 8000 0002" })]);
    expect((await on("00001", "reply", { reply: "more" })).status).toBe(400);
    await on("00001", "sent", { step: 0, title: 0 });
    await on("00002", "sent", { step: 0, title: 0 });
    const more = await json(await on("00001", "reply", { reply: "more", text: "Show me another." }));
    expect(more).toMatchObject({ prospect: { stage: "replied" }, owed: { text: "Show me another." } });
    expect((await json(await get("/api/outreach/today"))).owed).toMatchObject([{ prospect: { id: "00001" }, reply: { text: "Show me another." } }]);
    expect((await json(await on("00001", "answered"))).owed).toBeUndefined();
    expect((await json(await on("00002", "reply", { reply: "no" }))).prospect.stage).toBe("opted_out");
    expect((await json(await get("/api/outreach/prospects/00003"))).prospect.stage).toBe("opted_out");
    const again = await on("00003", "sent", { step: 0, title: 0 });
    expect(again.status).toBe(400);
    expect((await json(again)).message).toMatch(/opted out/);
  });

  it("sets a stage, a note, the channel and what the brand sells, and shows them on the prospect's page", async () => {
    await ready();
    await on("00001", "note", { text: "Met the founder at a fair." });
    await on("00001", "channel", { channel: "email" });
    await on("00001", "kind", { kind: "product" });
    const page = await json(await on("00001", "stage", { stage: "in_talks" }));
    expect(page).toMatchObject({ prospect: { stage: "in_talks", channel: "email" }, sells: "product", day: "2026-11-23" });
    expect(page.events.map((event: { type: string }) => event.type)).toEqual(["stage", "kind", "channel", "note", "ad_yes"]);
    expect((await json(await on("00001", "stage", { stage: "auto" }))).prospect.stage).toBe("ready");
    expect((await on("00001", "stage", { stage: "contacted" })).status).toBe(400);
    expect((await on("00009", "note", { text: "x" })).status).toBe(400);
    expect((await get("/api/outreach/prospects/00009")).status).toBe(404);
  });

  it("gives the owner the contact, each link only from a checked value", async () => {
    await loadProspects(studio, [row(1, { phone: "+65 6123 4567", instagram: "@brand.one", decisionMaker: "A Person", dmTitle: "Founder", linkedin: "www.linkedin.com/in/a-person", bestRoute: "WhatsApp" }), row(2, { instagram: "javascript:alert(1)", linkedin: "https://evil.example/in/x" })]);
    expect((await json(await get("/api/outreach/prospects/00001"))).contact).toEqual({
      whatsapp: [{ number: "6580000001", href: "https://wa.me/6580000001" }],
      email: { address: "hello@brand1.example", href: "mailto:hello@brand1.example" },
      phone: "+65 6123 4567",
      instagram: { name: "@brand.one", href: "https://www.instagram.com/brand.one/" },
      decisionMaker: "A Person",
      dmTitle: "Founder",
      linkedin: { text: "www.linkedin.com/in/a-person", href: "https://www.linkedin.com/in/a-person" },
      bestRoute: "WhatsApp",
    });
    expect((await json(await get("/api/outreach/prospects/00002"))).contact).toMatchObject({ instagram: { name: "javascript:alert(1)" }, linkedin: { text: "https://evil.example/in/x" } });
    expect((await json(await get("/api/outreach/prospects/00002"))).contact.instagram.href).toBeUndefined();
    expect((await json(await get("/api/outreach/prospects/00002"))).contact.linkedin.href).toBeUndefined();
  });
});

describe("the list and its numbers", () => {
  it("counts sent, replied, said more, opted out and clients, by tier and by channel, without the test prospect", async () => {
    await ready([row(1), row(2, { tier: "5-19 live ads" }), row(3, { whatsapp: undefined }), row(4, { tier: "<5 live ads", sector: "Beauty" }), row(5)]);
    const made = await json(await post("/api/outreach/test-prospect", { whatsapp: "+65 8999 0000" }));
    await on(made.id, "ad", { ad: 1, yes: true });
    for (const id of ["00001", "00002", "00003", "00004", made.id]) expect((await on(id, "sent", { step: 0, title: 0 })).status, id).toBe(200);
    await on("00001", "reply", { reply: "more" });
    await on("00002", "reply", { reply: "no" });
    await on("00003", "reply", { reply: "other" });
    await on("00003", "stage", { stage: "client" });
    await on(made.id, "reply", { reply: "no" });
    const page = await json(await get("/api/outreach/prospects"));
    expect(page.numbers).toEqual({
      prospects: 5,
      sent: { all: 4, byTier: { "20+": 2, "5-19": 1, "<5": 1 }, byChannel: { whatsapp: 3, email: 1 } },
      replied: { all: 3, byTier: { "20+": 2, "5-19": 1, "<5": 0 }, byChannel: { whatsapp: 2, email: 1 } },
      saidMore: { all: 1, byTier: { "20+": 1, "5-19": 0, "<5": 0 }, byChannel: { whatsapp: 1, email: 0 } },
      optedOut: { all: 1, byTier: { "20+": 0, "5-19": 1, "<5": 0 }, byChannel: { whatsapp: 1, email: 0 } },
      clients: { all: 1, byTier: { "20+": 1, "5-19": 0, "<5": 0 }, byChannel: { whatsapp: 0, email: 1 } },
    });
    expect(page.sectors).toEqual(["Beauty", "F&B", "Test"]);
    expect(page.rows.map((entry: { brand: string }) => entry.brand)).toEqual(["TEST prospect", "Brand 1", "Brand 2", "Brand 3", "Brand 4", "Brand 5"]);
    // A row of the list holds no number and no address.
    expect(JSON.stringify(page)).not.toMatch(/8000|8999|brand\d\.example/);
    // The test prospect took no place of the day.
    expect((await json(await get("/api/outreach/today"))).firstsSent).toBe(4);
  });

  it("searches by name and filters by tier, sector and stage", async () => {
    await ready([row(1, { brand: "Koi Tea" }), row(2, { brand: "Tea Bar", tier: "5-19 live ads" }), row(3, { brand: "Glow Lab", sector: "Beauty" })]);
    await on("00003", "stage", { stage: "lost" });
    const brands = async (query: string) => (await json(await get(`/api/outreach/prospects?${query}`))).rows.map((entry: { brand: string }) => entry.brand);
    expect(await brands("q=tea")).toEqual(["Koi Tea", "Tea Bar"]);
    expect(await brands("q=%20TEA%20&tier=5-19")).toEqual(["Tea Bar"]);
    expect(await brands("sector=Beauty")).toEqual(["Glow Lab"]);
    expect(await brands("stage=lost")).toEqual(["Glow Lab"]);
    expect(await brands("stage=ready&tier=20%2B")).toEqual(["Koi Tea"]);
    expect(await brands("q=nothing")).toEqual([]);
    expect((await get("/api/outreach/prospects?stage=sent")).status).toBe(400);
    expect((await get("/api/outreach/prospects?tier=big")).status).toBe(400);
  });
});

describe("the message text and the test prospect", () => {
  it("shows the messages and saves the owner's change; an unknown placeholder is refused", async () => {
    expect(await json(await get("/api/outreach/templates"))).toEqual({ daily: 5, dailyMin: 1, dailyMax: 20, placeholder: "{Brand}" });
    expect((await post("/api/outreach/templates", { steps: TEMPLATES })).status).toBe(200);
    expect((await json(await get("/api/outreach/templates"))).templates.steps[2].titles).toEqual(["Last one, {Brand}", "{Brand}, one more before I go"]);
    const bad = await post("/api/outreach/templates", { steps: [{ ...TEMPLATES[0], body: "Hi {Name}, an ad for {Brand}." }, TEMPLATES[1], TEMPLATES[2]] });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe("refused");
    expect((await json(await get("/api/outreach/templates"))).templates.steps[0].body).toBe("Hi, I made this ad for {Brand}.");
  });

  it("makes a test prospect with an ad that waits, and removes it with everything of it; no other prospect can be removed", async () => {
    await loadProspects(studio);
    const before = (await studio.table.query("OUTREACH")).length;
    const made = await json(await post("/api/outreach/test-prospect", { email: "me@test.example" }));
    const page = await json(await get(`/api/outreach/prospects/${made.id}`));
    expect(page).toMatchObject({ prospect: { brand: "TEST prospect", test: true, stage: "ad_waits", channel: "email" }, ads: [{ n: 1, viewUrl: expect.stringContaining("outreach/test-ad.png") }] });
    await on(made.id, "ad", { ad: 1, yes: true });
    await on(made.id, "optout");
    expect(await outreach().store.optOuts()).toEqual(new Set());
    expect(await json(await on(made.id, "remove"))).toEqual({ removed: true });
    expect((await studio.table.query("OUTREACH")).length).toBe(before);
    const real = await on("00001", "remove");
    expect(real.status).toBe(400);
    expect((await json(real)).message).toMatch(/Only a test prospect/);
    expect((await post("/api/outreach/test-prospect", { email: "not an address" })).status).toBe(400);
  });
});

/** Asks for an address, puts `body` where it points, as the owner's browser would, and lets the studio read it. */
async function upload(id: string, body: Uint8Array, type = "image/png") {
  const started = await json(await post(`/api/outreach/prospects/${id}/picture`, { type, bytes: body.length }));
  const key = new URL(started.putUrl).pathname.slice(1);
  await studio.pictures.put(key, body, type);
  const done = await post(`/api/outreach/prospects/${id}/picture/${started.uploadId}/done`);
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  return { started, key, done };
}

describe("the owner's own picture", () => {
  it("attaches his picture as the newest ad with his yes, so the first message is ready with no batch", async () => {
    const [id] = await loadProspects(studio);
    await outreach().sequence.saveTemplates(TEMPLATES as never);
    const { started, key, done } = await upload(id!, PNG);
    expect(started.putUrl).toContain(`outreach/inbox/${id}/${started.uploadId}`);
    expect(started.putUrl).toContain("type=image%2Fpng&bytes=12");
    expect(done.status).toBe(200);
    const page = await json(done);
    expect(page).toMatchObject({ prospect: { stage: "ready" }, ads: [{ n: 1, from: "owner", batchId: "owner", verdict: "yes", viewUrl: expect.stringContaining(`outreach/owner/${id}/${started.uploadId}.png`) }] });
    expect(page.ads[0].kind).toBeUndefined();
    // The studio keeps its own copy, and the place the browser wrote to is emptied.
    expect(studio.pictures.files.has(key)).toBe(false);
    expect(studio.pictures.files.get(`outreach/owner/${id}/${started.uploadId}.png`)).toEqual({ body: PNG, type: "image/png" });
    expect((await on(id!, "sent", { step: 0, title: 0 })).status).toBe(200);
  });

  it("tells the type by the file's first bytes, not by what was said of it", async () => {
    const [id] = await loadProspects(studio);
    const { started, done } = await upload(id!, JPEG, "image/png");
    expect((await json(done)).ads[0].viewUrl).toContain(`${started.uploadId}.jpg`);
    expect(studio.pictures.files.get(`outreach/owner/${id}/${started.uploadId}.jpg`)?.type).toBe("image/jpeg");
  });

  it("keeps nothing of a file that is no JPEG or PNG, whatever it was called", async () => {
    const [id] = await loadProspects(studio);
    for (const body of [new TextEncoder().encode("<svg onload=alert(1)>"), new TextEncoder().encode("MZ this is a program"), new TextEncoder().encode("RIFF0000WEBPVP8 ")]) {
      const { key, done } = await upload(id!, body);
      expect(done.status).toBe(400);
      expect((await json(done)).message).toMatch(/not a JPEG or a PNG/);
      expect(studio.pictures.files.has(key)).toBe(false);
    }
    expect((await outreach().store.all())[0]).toMatchObject({ ads: [], events: [] });
    expect([...studio.pictures.files.keys()].filter((key) => key.startsWith("outreach/"))).toEqual([]);
  });

  it("refuses another type, a size out of range, an upload that never arrived and an id that is none", async () => {
    const [id] = await loadProspects(studio);
    const door = `/api/outreach/prospects/${id}/picture`;
    for (const body of [{ type: "image/webp", bytes: 12 }, { type: "image/svg+xml", bytes: 12 }, { type: "image/png", bytes: 0 }, { type: "image/png", bytes: 8_000_001 }]) {
      expect((await post(door, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(`${door}/${UPLOAD}/done`)).status).toBe(400);
    expect((await post(`${door}/..%2F..%2Fbrands/done`)).status).toBe(400);
    expect((await post("/api/outreach/prospects/99999/picture", { type: "image/png", bytes: 12 })).status).toBe(400);
    expect((await outreach().store.all())[0]!.ads).toEqual([]);
  });

  it("attaches one upload once, however often it is confirmed", async () => {
    const [id] = await loadProspects(studio);
    const { started } = await upload(id!, PNG);
    const again = await post(`/api/outreach/prospects/${id}/picture/${started.uploadId}/done`);
    expect(again.status).toBe(200);
    const file = (await outreach().store.all())[0]!;
    expect(file.ads).toHaveLength(1);
    expect(file.events.filter((event) => event.type === "ad_yes")).toHaveLength(1);
  });

  it("attaches one upload once when two confirmations come at the same moment", async () => {
    const [id] = await loadProspects(studio);
    const started = await json(await post(`/api/outreach/prospects/${id}/picture`, { type: "image/png", bytes: PNG.length }));
    await studio.pictures.put(new URL(started.putUrl).pathname.slice(1), PNG, "image/png");
    const door = `/api/outreach/prospects/${id}/picture/${started.uploadId}/done`;
    const both = await Promise.all([post(door), post(door)]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await outreach().store.all())[0]!.ads).toHaveLength(1);
    // The one that was told to wait gets the same ad when it asks again.
    expect((await post(door)).status).toBe(200);
    expect((await outreach().store.all())[0]!.ads).toHaveLength(1);
  });

  it("lets an upload be confirmed again when the first confirmation could not keep it", async () => {
    const [id] = await loadProspects(studio);
    const started = await json(await post(`/api/outreach/prospects/${id}/picture`, { type: "image/png", bytes: PNG.length }));
    const door = `/api/outreach/prospects/${id}/picture/${started.uploadId}/done`;
    // Confirmed before the file arrived: refused, and the upload is not held.
    expect((await post(door)).status).toBe(400);
    await studio.pictures.put(new URL(started.putUrl).pathname.slice(1), PNG, "image/png");
    expect((await post(door)).status).toBe(200);
    expect((await outreach().store.all())[0]!.ads).toHaveLength(1);
  });

  it("takes over an upload whose confirmation was cut off, once a minute has passed", async () => {
    const [id] = await loadProspects(studio);
    const started = await json(await post(`/api/outreach/prospects/${id}/picture`, { type: "image/png", bytes: PNG.length }));
    await studio.pictures.put(new URL(started.putUrl).pathname.slice(1), PNG, "image/png");
    const door = `/api/outreach/prospects/${id}/picture/${started.uploadId}/done`;
    // A confirmation that was stopped half way: it took the upload and never gave it back.
    expect(await outreach().store.claimUpload(id!, started.uploadId)).toBe(true);
    expect((await post(door)).status).toBe(400);
    studio.clock.now = new Date(studio.clock.now.getTime() + 59_000);
    expect((await post(door)).status).toBe(400);
    studio.clock.now = new Date(studio.clock.now.getTime() + 2_000);
    const both = await Promise.all([post(door), post(door)]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await outreach().store.all())[0]!.ads).toHaveLength(1);
  });

  it("puts his picture after an agent's ad, and it is then the one the message carries", async () => {
    await ready();
    const { started, done } = await upload("00001", PNG);
    const page = await json(done);
    expect(page.ads.map((ad: { n: number; from?: string }) => [ad.n, ad.from])).toEqual([[2, "owner"], [1, undefined]]);
    expect(page.ads[0]).toMatchObject({ verdict: "yes", downloadUrl: expect.stringContaining(started.uploadId) });
    expect(page.message.step).toBe(0);
    const today = await json(await get("/api/outreach/today"));
    expect(JSON.stringify(today)).toContain(started.uploadId);
  });

  it("removes his picture with the test prospect it was uploaded to", async () => {
    const made = await json(await post("/api/outreach/test-prospect", {}));
    const { started } = await upload(made.id, PNG);
    const kept = `outreach/owner/${made.id}/${started.uploadId}.png`;
    expect(studio.pictures.files.has(kept)).toBe(true);
    expect(await json(await on(made.id, "remove"))).toEqual({ removed: true });
    expect(studio.pictures.files.has(kept)).toBe(false);
  });

  it("keeps the picture of a real prospect when its removal is refused", async () => {
    const [id] = await loadProspects(studio);
    const { started } = await upload(id!, PNG);
    const refused = await on(id!, "remove");
    expect(refused.status).toBe(400);
    expect((await json(refused)).message).toMatch(/Only a test prospect/);
    expect(studio.pictures.files.has(`outreach/owner/${id}/${started.uploadId}.png`)).toBe(true);
  });

  it("keeps the test prospect when its picture could not be removed, so the removal can be run again", async () => {
    const made = await json(await post("/api/outreach/test-prospect", {}));
    const { started } = await upload(made.id, PNG);
    const kept = `outreach/owner/${made.id}/${started.uploadId}.png`;
    const remove = studio.pictures.remove.bind(studio.pictures);
    studio.pictures.remove = async () => {
      throw new Error("store is down");
    };
    expect((await on(made.id, "remove")).status).toBeGreaterThanOrEqual(400);
    expect(await outreach().store.find(made.id)).toBeDefined();
    studio.pictures.remove = remove;
    expect(await json(await on(made.id, "remove"))).toEqual({ removed: true });
    expect(studio.pictures.files.has(kept)).toBe(false);
    expect(await outreach().store.find(made.id)).toBeUndefined();
  });

  it("lets a brand that sells a service go on with his picture, and keeps none for a contact that opted out", async () => {
    const [id] = await loadProspects(studio);
    await on(id!, "kind", { kind: "service" });
    expect((await json(await get(`/api/outreach/prospects/${id}`))).prospect.stage).toBe("needs_service_ad");
    expect((await json((await upload(id!, PNG)).done)).prospect.stage).toBe("ready");
    await on(id!, "optout");
    expect((await post(`/api/outreach/prospects/${id}/picture`, { type: "image/png", bytes: 12 })).status).toBe(400);
  });
});

describe("the owner's pick of the ad", () => {
  const RULES = { rulesVersion: RULES_VERSION };
  const page = async (id = "00001") => json(await get(`/api/outreach/prospects/${id}`));
  const attention = async () => (await json(await get("/api/attention"))).lines as { kind: string; count: number; to: string }[];

  /** One brand whose nine drafts are shown; the agent saw a pack that is too tall in the second draft of the first idea. */
  async function shown() {
    await loadProspects(studio);
    await outreach().sequence.saveTemplates(TEMPLATES as never);
    const batchId = await outreachBatch(studio, "00001", { upTo: "checked" });
    const board = (await callTool(studio, "board_show", { batchId })).value;
    const bad = board.ideas[0].drafts[1].image.id as string;
    await callTool(studio, "checks_save", { ...RULES, batchId, imageId: bad, items: [{ code: "D11", note: "The pouch is too tall." }] });
    await callTool(studio, "outreach_show", { batchId });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    return { batchId, bad };
  }

  it("shows every draft of every idea, blocks none for a check, and counts the brand as waiting for him", async () => {
    const { batchId, bad } = await shown();
    const { prospect, candidates } = await page();
    expect(prospect).toMatchObject({ stage: "pick_waits" });
    expect(candidates).toMatchObject({ batchId, choosing: "open", waits: true, words: false });
    expect(candidates.picked).toBeUndefined();
    expect(candidates.drafts).toHaveLength(9);
    expect(new Set(candidates.drafts.map((draft: { ideaId: string }) => draft.ideaId))).toEqual(new Set(["idea-1", "idea-2", "idea-3"]));
    expect(candidates.drafts.filter((draft: { blocked?: string }) => draft.blocked)).toEqual([]);
    expect(candidates.drafts.filter((draft: { warning?: string }) => draft.warning)).toEqual([expect.objectContaining({ imageId: bad, warning: "The agent saw: The pouch is too tall.", findings: ["The agent saw: The pouch is too tall."] })]);
    for (const draft of candidates.drafts) expect(draft.viewUrl).toMatch(/^https:\/\//);
    const today = await json(await get("/api/outreach/today"));
    expect(today.picks).toMatchObject([{ prospect: { id: "00001", brand: "Brand 1", stage: "pick_waits" }, drafts: 9 }]);
    expect(today.firsts).toEqual([]);
    expect(await attention()).toContainEqual(expect.objectContaining({ kind: "ad_picks", count: 1, to: "/outreach" }));
  });

  it("takes his pick of a draft the checks faulted: it is his to judge", async () => {
    const { bad } = await shown();
    const picked = await on("00001", "pick", { imageId: bad });
    expect(picked.status).toBe(200);
    expect(await json(picked)).toMatchObject({ prospect: { stage: "pick_made" }, candidates: { picked: { imageId: bad } } });
  });

  it("refuses a picture that is no draft of the brand, and words where the ad has none", async () => {
    await shown();
    expect((await json(await on("00001", "pick", { imageId: "no-such-picture" }))).message).toMatch(/not one of this brand's drafts/);
    const { candidates } = await page();
    const good = candidates.drafts.find((draft: { blocked?: string }) => !draft.blocked).imageId;
    expect((await on("00001", "words", { imageId: good, ownerSaid: "Say the price." })).status).toBe(400);
    expect((await on("00001", "none", { ownerSaid: "   " })).status).toBe(400);
    expect((await page()).prospect.stage).toBe("pick_waits");
  });

  it("takes his pick once, sends nothing, and lets him pick another before the final is made", async () => {
    const { batchId } = await shown();
    const before = await page();
    const [first, second] = before.candidates.drafts.filter((draft: { blocked?: string }) => !draft.blocked);
    const picked = await json(await on("00001", "pick", { imageId: first.imageId }));
    expect(picked).toMatchObject({ prospect: { stage: "pick_made" }, candidates: { picked: { imageId: first.imageId }, choosing: "open", waits: false }, ads: [] });
    // The same pick again, twice at one moment, changes nothing.
    await Promise.all([on("00001", "pick", { imageId: first.imageId }), on("00001", "pick", { imageId: first.imageId })]);
    const file = async () => (await outreach().store.all())[0]!;
    expect((await file()).events.filter((event) => event.type === "pick")).toHaveLength(1);
    expect((await file()).sends).toEqual([]);
    expect((await json(await get("/api/outreach/today"))).picks).toEqual([]);
    expect((await attention()).some((group) => group.kind === "ad_picks")).toBe(false);
    expect((await callTool(studio, "outreach_next", {})).value.owed).toMatchObject([{ batchId, owes: "final", imageId: first.imageId }]);
    await on("00001", "pick", { imageId: second.imageId });
    expect((await callTool(studio, "outreach_next", {})).value.owed).toMatchObject([{ batchId, owes: "final", imageId: second.imageId }]);
    // "None of these" is for drafts that wait: he has picked.
    expect((await json(await on("00001", "none", { ownerSaid: "On second thought." }))).message).toMatch(/do not wait for your pick now/);
  });

  it("makes the brand ready with the final of his pick, and only his own click marks the message as sent", async () => {
    await loadProspects(studio);
    await outreach().sequence.saveTemplates(TEMPLATES as never);
    const batchId = await outreachBatch(studio, "00001");
    await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its own colour." });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const ready = await page();
    expect(ready).toMatchObject({ prospect: { stage: "ready", adWaits: false }, ads: [{ n: 1, verdict: "yes", picked: true }] });
    expect((await outreach().store.all())[0]!.sends).toEqual([]);
    expect((await json(await get("/api/outreach/today"))).firsts).toMatchObject([{ prospect: { id: "00001" } }]);
    expect((await on("00001", "sent", { step: 0, title: 0 })).status).toBe(200);
    // After the message has gone he cannot take back his yes to the ad it carried.
    expect((await on("00001", "ad", { ad: 1, yes: false, ownerSaid: "Too late." })).status).toBe(400);
  });

  it("takes his no to the full-size ad without a second try used up, and brings the drafts back", async () => {
    await loadProspects(studio);
    const batchId = await outreachBatch(studio, "00001");
    await callTool(studio, "outreach_attach", { batchId, why: "The pouch on its own colour." });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const after = await json(await on("00001", "ad", { ad: 1, yes: false, ownerSaid: "The pack went soft." }));
    expect(after).toMatchObject({ prospect: { stage: "pick_waits" }, ads: [{ n: 1, verdict: "no" }], candidates: { choosing: "open", waits: true } });
    expect(after.candidates.drafts.filter((draft: { blocked?: string }) => draft.blocked)).toMatchObject([{ blocked: "You said no to its full-size version." }]);
  });

  it("parks the brand after his second none, and gives his words to the agent after the first", async () => {
    await shown();
    const first = await json(await on("00001", "none", { ownerSaid: "The headline says nothing." }));
    expect(first).toMatchObject({ prospect: { stage: "new" }, candidates: { waits: false } });
    expect((await callTool(studio, "outreach_next", {})).value.brands).toMatchObject([{ id: "00001", why: "again", ownerSaid: "The headline says nothing." }]);
    await outreachBatch(studio, "00001", { upTo: "shown" });
    const second = await json(await on("00001", "none", { ownerSaid: "Still nothing." }));
    expect(second).toMatchObject({ prospect: { stage: "parked" }, candidates: { choosing: "closed" } });
    expect((await on("00001", "pick", { imageId: second.candidates.drafts[0].imageId })).status).toBe(400);
  });

  it("is ready with his own picture when he uploads it while the drafts wait, and asks for no pick any more", async () => {
    await shown();
    const after = await json((await upload("00001", PNG)).done);
    expect(after).toMatchObject({ prospect: { stage: "ready" }, ads: [{ n: 1, from: "owner", verdict: "yes" }], candidates: { choosing: "open", waits: false, agentOwes: false } });
    const today = await json(await get("/api/outreach/today"));
    expect(today.picks).toEqual([]);
    expect(today.firsts).toMatchObject([{ prospect: { id: "00001" } }]);
    expect(await attention()).not.toContainEqual(expect.objectContaining({ kind: "ad_picks" }));
  });

  it("owes the agent nothing once he uploads his own picture after his pick, and owes it again when he picks after that", async () => {
    await shown();
    const { candidates } = await page();
    const [first, second] = candidates.drafts.filter((draft: { blocked?: string }) => !draft.blocked);
    await on("00001", "pick", { imageId: first.imageId });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    const uploaded = await json((await upload("00001", PNG)).done);
    expect(uploaded).toMatchObject({ prospect: { stage: "ready" }, candidates: { agentOwes: false } });
    expect((await callTool(studio, "outreach_next", {})).value.owed).toEqual([]);
    const again = await json(await on("00001", "pick", { imageId: second.imageId }));
    // His picture stays ready to send while the agent makes the final of the draft he picked after it.
    expect(again).toMatchObject({ prospect: { stage: "ready" }, candidates: { agentOwes: true, picked: { imageId: second.imageId } } });
    expect((await callTool(studio, "outreach_next", {})).value.owed).toMatchObject([{ id: "00001", owes: "final", imageId: second.imageId }]);
  });

  it("saves his none on the next click when the first one could not be saved", async () => {
    await shown();
    const file = async () => (await outreach().store.all())[0]!;
    const save = vi.spyOn(outreach().store, "addEvent").mockRejectedValueOnce(new Error("The table did not answer."));
    expect((await on("00001", "none", { ownerSaid: "The headline says nothing." })).status).toBe(500);
    save.mockRestore();
    expect((await file()).events.filter((event) => event.type === "none")).toHaveLength(0);
    expect(await json(await on("00001", "none", { ownerSaid: "The headline says nothing." }))).toMatchObject({ prospect: { stage: "new" } });
    expect((await file()).events.filter((event) => event.type === "none")).toMatchObject([{ ownerSaid: "The headline says nothing." }]);
  });

  it("saves his none after a minute when the call that took it was cut off before it saved", async () => {
    await shown();
    const file = async () => (await outreach().store.all())[0]!;
    const drafts = (await file()).events.find((event) => event.type === "candidates")!;
    // A call that was stopped after it took the mark and before it saved his words.
    expect(await outreach().store.once("00001", `none-${drafts.id}`)).toBe(true);
    await on("00001", "none", { ownerSaid: "The headline says nothing." });
    expect((await file()).events.filter((event) => event.type === "none")).toHaveLength(0);
    studio.clock.now = new Date(studio.clock.now.getTime() + 61_000);
    expect(await json(await on("00001", "none", { ownerSaid: "The headline says nothing." }))).toMatchObject({ prospect: { stage: "new" } });
    expect((await file()).events.filter((event) => event.type === "none")).toHaveLength(1);
  });

  it("asks nothing for a brand that opted out", async () => {
    await shown();
    await on("00001", "optout");
    const { prospect, candidates } = await page();
    expect(prospect.stage).toBe("opted_out");
    expect(candidates).toMatchObject({ choosing: "closed" });
    expect((await on("00001", "pick", { imageId: candidates.drafts[0].imageId })).status).toBe(400);
    expect((await json(await get("/api/outreach/today"))).picks).toEqual([]);
  });

  it("puts none of the owner's words in a log line", async () => {
    await shown();
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(String(line)));
    await on("00001", "none", { ownerSaid: "A secret thought about the brand." });
    spy.mockRestore();
    expect(lines.join("\n")).not.toMatch(/secret thought/);
  });
});
