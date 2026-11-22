import type { MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { loggedPath } from "../../src/app.js";
import { createStudio, json, ORIGIN, sessionCookie, type Studio } from "../helpers/deps.js";
import { JPEG, PNG } from "../helpers/pictures.js";

const OWNER = "owner@example.com";
const AD = "a11_cake";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });
const tokenOf = (link: string) => new URL(link).pathname.split("/").at(-1) as string;

let studio: Studio;
let brandId: string;
let packId: string;
let packToken: string;
let clientToken: string;
let ref: string;

async function carried(of: string, product: string, example = false) {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: JPEG.length }]);
  await studio.pictures.put(`carried/${carryId}/0`, JPEG, "image/jpeg");
  return studio.services.pack.carry(OWNER, {
    carryId,
    brandId: of,
    product,
    ads: [{ adName: example ? "a11_example" : AD, picture: 0, variants: [variant("A"), variant("B")], why: "Why.", claims: [] }],
    launchPlan: ["Run for 72 hours."],
    ...(example ? { example: { note: "Example. Not a client.", comments: [{ text: "Could the price be larger?", adName: "a11_example", change: { what: "offer" as const, status: "done" as const, version: 2 } }] } } : {}),
  });
}

const get = (path: string, headers: Record<string, string> = {}) => studio.app.request(path, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  studio.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const asOwner = async () => ({ cookie: await sessionCookie(studio), origin: ORIGIN });

beforeEach(async () => {
  studio = await createStudio();
  brandId = (await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: null, palette: [], fonts: [], savedBy: OWNER })).id;
  const made = await carried(brandId, "Cake");
  packId = made.packId;
  packToken = tokenOf(made.link);
  clientToken = tokenOf((await studio.services.clients.make(brandId, OWNER)).link);
  ref = (await json(await get(`/api/client/${clientToken}`))).packs[0].ref;
});

describe("a client's link", () => {
  it("opens every pack of the brand, tells no search engine and no other site, and is never kept by a browser's cache", async () => {
    const opened = await get(`/api/client/${clientToken}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(opened.headers.get("referrer-policy")).toBe("no-referrer");
    expect(opened.headers.get("cache-control")).toBe("no-store");
    const view = await json(opened);
    expect(view).toMatchObject({ brand: "WonGi", packs: [{ ref, product: "Cake", comments: [] }] });
    expect(JSON.stringify({ ...view, packs: view.packs.map((pack: { ads: object[] }) => ({ ...pack, ads: pack.ads.map((ad) => ({ ...ad, viewUrl: "" })) })) })).not.toContain(packId);
  });

  it("answers a wrong, a badly shaped and a pack's token exactly as a page that never was", async () => {
    const answers = await Promise.all(["x".repeat(43), "short", packToken, "%2e%2e"].map(async (token) => get(`/api/client/${token}`)));
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ error: "not_found" });
    }
    // A client's token opens no single pack either, and a reference of another brand's pack opens nothing.
    expect((await get(`/api/pack/${clientToken}`)).status).toBe(404);
    const other = (await studio.services.brands.saveBrand({ name: "Other", url: "https://other.example/", logo: null, palette: [], fonts: [], savedBy: OWNER })).id;
    await carried(other, "Tea");
    const otherRef = (await json(await get(`/api/client/${tokenOf((await studio.services.clients.make(other, OWNER)).link)}`))).packs[0].ref;
    expect((await post(`/api/client/${clientToken}/packs/${otherRef}/comments`, { text: "hello" })).status).toBe(404);
    expect((await get(`/api/client/${clientToken}/packs/${otherRef}/download/0`)).status).toBe(404);
  });

  it("answers a wrong link the same whatever is sent with it", async () => {
    const wrong = "x".repeat(43);
    for (const path of [`/api/client/${wrong}/packs/${ref}/comments`, `/api/client/${wrong}/packs/${ref}/uploads`, `/api/pack/${wrong}/comments`, `/api/pack/${wrong}/uploads`]) {
      for (const body of [{}, { text: "hello" }, { name: "a.png", type: "image/png", bytes: 1 }]) {
        const answer = await post(path, body);
        expect(answer.status).toBe(404);
        expect(await answer.json()).toEqual({ error: "not_found" });
      }
    }
    // A real link still says what is wrong with what was sent.
    expect((await post(`/api/client/${clientToken}/packs/${ref}/uploads`, { text: "hello" })).status).toBe(400);
    expect((await post(`/api/client/${clientToken}/packs/${ref}/comments`, {})).status).toBe(400);
  });

  it("is never written to a log line", () => {
    expect(loggedPath(`/api/client/${clientToken}/packs/${ref}/comments`)).toBe(`/api/client/<token>/packs/${ref}/comments`);
    expect(loggedPath(`/api/pack/${packToken}/download/0`)).toBe("/api/pack/<token>/download/0");
  });
});

describe("what a client does with a pack", () => {
  for (const [name, prefix] of [
    ["through the client's link", () => `/api/client/${clientToken}/packs/${ref}`],
    ["through the pack's link", () => `/api/pack/${packToken}`],
  ] as const) {
    it(`downloads an ad ${name}`, async () => {
      const { url } = await json(await get(`${prefix()}/download/0`));
      expect(url).toContain(`download=${AD}.jpg`);
      for (const ad of ["1", "-1", "x", "0.5"]) expect((await get(`${prefix()}/download/${ad}`)).status).toBe(404);
      expect((await get(`${prefix()}/download/0?format=png`)).status).toBe(404);
    });

    it(`comments and asks for a change ${name}, and the owner gets a notice without the words`, async () => {
      expect((await post(`${prefix()}/comments`, { text: "We love <b>these</b>." })).status).toBe(200);
      studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
      const asked = await post(`${prefix()}/comments`, { text: "Make the price larger.", adName: AD, change: "offer" });
      expect((await json(asked)).comment).toMatchObject({ adName: AD, change: { what: "offer", status: "received" } });
      for (const bad of [{ text: "" }, { text: "x".repeat(1001) }, { text: 5 }, { text: "hello", adName: "not-an-ad" }, { text: "hello", change: "offer" }, { text: "hello", adName: AD, change: { what: "offer", status: "done" } }, { text: "hello", adName: AD, change: "done" }, { text: "hello", extra: 1 }, "text"]) {
        expect((await post(`${prefix()}/comments`, bad)).status).toBe(400);
      }
      const shown = name.includes("client") ? (await json(await get(`/api/client/${clientToken}`))).packs[0].comments : (await json(await get(`/api/pack/${packToken}`))).comments;
      expect(shown).toMatchObject([{ text: "We love <b>these</b>." }, { text: "Make the price larger.", change: { status: "received" } }]);
      expect(JSON.stringify(shown)).not.toContain('"id"');
      expect(studio.activities).toMatchObject([{ brand: "WonGi", kind: "comment" }]);
      expect(JSON.stringify(studio.activities)).not.toContain("love");
    });

    it(`sends a file ${name}: the studio reads it, keeps a real picture and deletes anything else`, async () => {
      const taken = await json(await post(`${prefix()}/uploads`, { name: "week-1.png", type: "image/png", bytes: PNG.length }));
      expect((await json(await post(`${prefix()}/uploads/${taken.upload.id}/done`, {}))).state).toBe("waiting");
      const [upload] = await studio.services.results.uploads(packId);
      await studio.pictures.put(upload!.key, PNG, "image/png");
      expect((await json(await post(`${prefix()}/uploads/${taken.upload.id}/done`, {}))).state).toBe("checked");
      expect(studio.activities).toMatchObject([{ kind: "file" }]);

      const fake = await json(await post(`${prefix()}/uploads`, { name: "invoice.png", type: "image/png", bytes: 8 }));
      const key = (await studio.services.results.uploads(packId)).find((entry) => entry.id === fake.upload.id)!.key;
      await studio.pictures.put(key, new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), "image/png");
      expect((await json(await post(`${prefix()}/uploads/${fake.upload.id}/done`, {}))).state).toBe("refused");
      expect(studio.pictures.files.has(key)).toBe(false);
      expect((await post(`${prefix()}/uploads/nope/done`, {})).status).toBe(400);
      expect((await post(`${prefix()}/uploads`, { name: "export.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: 100 })).status).toBe(400);
    });
  }

  it("is refused on an example, whatever the page that asks looks like, and the example still downloads with its mark", async () => {
    const example = tokenOf((await carried(brandId, "Example cake", true)).link);
    const view = await json(await get(`/api/pack/${example}`));
    expect(view.example.comments).toHaveLength(1);
    expect(view).not.toHaveProperty("comments");
    expect(await json(await post(`/api/pack/${example}/comments`, { text: "hello" }))).toMatchObject({ error: "refused", message: expect.stringContaining("example") });
    expect(await json(await post(`/api/pack/${example}/uploads`, { name: "a.png", type: "image/png", bytes: 10 }))).toMatchObject({ error: "refused" });
    expect((await json(await get(`/api/pack/${example}/download/0`))).url).toContain("download=example_a11_example.");
    expect(studio.activities).toEqual([]);
    // The client's page of the same brand does not show the example.
    expect((await json(await get(`/api/client/${clientToken}`))).packs).toHaveLength(1);
  });
});

describe("the owner's side", () => {
  it("needs the owner's session, and a write needs the dashboard's origin", async () => {
    const member = { cookie: await sessionCookie(studio, "member"), origin: ORIGIN };
    expect((await get("/api/portal")).status).toBe(401);
    expect((await get("/api/portal", member)).status).toBe(403);
    expect((await get(`/api/packs/${packId}/uploads/x/table`, member)).status).toBe(403);
    expect((await post(`/api/portal/${brandId}/link`, { action: "replace" }, member)).status).toBe(403);
    expect((await post(`/api/portal/${brandId}/link`, { action: "replace" }, { cookie: await sessionCookie(studio) })).status).toBe(403);
    expect((await post(`/api/packs/${packId}/comments/x`, { hidden: true }, member)).status).toBe(403);
    // None of these replaced the link.
    expect((await get(`/api/client/${clientToken}`)).status).toBe(200);
  });

  it("lists each client with the packs, the comments and the files, and never a link or a key", async () => {
    await post(`/api/pack/${packToken}/comments`, { text: "Make the price larger.", adName: AD, change: "offer" });
    const taken = await json(await post(`/api/pack/${packToken}/uploads`, { name: "week-1.csv", type: "text/csv", bytes: 30 }));
    const [upload] = await studio.services.results.uploads(packId);
    await studio.pictures.put(upload!.key, new TextEncoder().encode('Ad name,Clicks\n=cmd|"/c calc"!A1,12\n'), "text/csv");
    const owner = await asOwner();
    const { clients } = await json(await get("/api/portal", owner));
    expect(clients).toMatchObject([
      {
        brand: { id: brandId, name: "WonGi" },
        link: { state: "on" },
        packs: [{ packId, product: "Cake", example: false, ads: [{ adName: AD }], comments: [{ text: "Make the price larger.", change: { what: "offer", status: "received" } }], uploads: [{ id: taken.upload.id, state: "checked" }] }],
      },
    ]);
    const text = JSON.stringify(clients);
    for (const secret of [clientToken, packToken, "tokenHash", '"key"', "quarantine/"]) expect(text).not.toContain(secret);
    // A CSV has no address: it is read as a table of text, and a formula stays characters.
    expect(clients[0].packs[0].uploads[0]).not.toHaveProperty("openUrl");
    expect(await json(await get(`/api/packs/${packId}/uploads/${taken.upload.id}/table`, owner))).toEqual({ rows: [["Ad name", "Clicks"], ['=cmd|"/c calc"!A1', "12"]], cut: false });
    expect((await get(`/api/packs/${packId}/uploads/nope/table`, owner)).status).toBe(400);
  });

  it("sets where a change request stands, and hides a comment from the client's page", async () => {
    await post(`/api/pack/${packToken}/comments`, { text: "Make the price larger.", adName: AD, change: "offer" });
    const owner = await asOwner();
    const id = (await json(await get("/api/portal", owner))).clients[0].packs[0].comments[0].id;
    expect((await json(await post(`/api/packs/${packId}/comments/${id}`, { status: "done" }, owner))).comment.change).toEqual({ what: "offer", status: "done", version: 1 });
    expect((await json(await get(`/api/pack/${packToken}`))).comments[0].change.status).toBe("done");
    for (const bad of [{ status: "finished" }, { status: "done", hidden: true }, {}, { hidden: "yes" }]) expect((await post(`/api/packs/${packId}/comments/${id}`, bad, owner)).status).toBe(400);
    expect((await post(`/api/packs/nope/comments/${id}`, { hidden: true }, owner)).status).toBe(404);
    expect((await post(`/api/packs/${packId}/comments/${id}`, { hidden: true }, owner)).status).toBe(200);
    expect((await json(await get(`/api/pack/${packToken}`))).comments).toEqual([]);
    expect((await json(await get("/api/portal", owner))).clients[0].packs[0].comments).toMatchObject([{ id, hidden: true }]);
  });

  it("replaces and turns off a client's link, and shows a new link once", async () => {
    const owner = await asOwner();
    expect((await post(`/api/portal/${brandId}/link`, { action: "make" }, owner)).status).toBe(400);
    const replaced = await post(`/api/portal/${brandId}/link`, { action: "replace" }, owner);
    expect(replaced.headers.get("cache-control")).toBe("no-store");
    const next = tokenOf((await json(replaced)).url);
    expect((await get(`/api/client/${clientToken}`)).status).toBe(404);
    expect((await get(`/api/client/${next}`)).status).toBe(200);
    expect((await json(await post(`/api/portal/${brandId}/link`, { action: "off" }, owner))).link).toMatchObject({ state: "off" });
    expect((await get(`/api/client/${next}`)).status).toBe(404);
    expect((await post(`/api/portal/${brandId}/link`, { action: "delete" }, owner)).status).toBe(400);
    expect((await post("/api/portal/no-such-brand/link", { action: "make" }, owner)).status).toBe(400);
  });
});
