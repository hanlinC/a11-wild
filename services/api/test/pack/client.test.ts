import type { MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { packRef } from "../../src/pack/client.js";
import { hashToken } from "../../src/pack/service.js";
import { createStudio, type Studio } from "../helpers/deps.js";
import { JPEG } from "../helpers/pictures.js";

const OWNER = "owner@example.com";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });

let studio: Studio;
let brandId: string;
let otherId: string;

const brand = async (name: string) => (await studio.services.brands.saveBrand({ name, url: `https://${name.toLowerCase()}.example/`, logo: null, palette: [], fonts: [], savedBy: OWNER })).id;
/** A carried pack of a brand, made a second after the one before it. */
async function pack(of: string, product: string, example = false) {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: JPEG.length }]);
  await studio.pictures.put(`carried/${carryId}/0`, JPEG, "image/jpeg");
  return studio.services.pack.carry(OWNER, {
    carryId,
    brandId: of,
    product,
    ads: [{ adName: `a11_${product.replace(/\W/g, "")}`, picture: 0, variants: [variant("A"), variant("B")], why: "Why.", claims: [] }],
    launchPlan: ["Run for 72 hours."],
    ...(example ? { example: { note: "Example. Not a client.", comments: [] } } : {}),
  });
}
const token = (link: string) => new URL(link).pathname.split("/").at(-1) as string;
const view = (link: string) => studio.services.clients.view(token(link));
const stored = () => JSON.stringify([...studio.table.items.values()]);

beforeEach(async () => {
  studio = await createStudio();
  brandId = await brand("WonGi");
  otherId = await brand("Other");
});

describe("a client link", () => {
  it("opens every pack of its brand, newest first, each at the version its own link shows", async () => {
    await pack(brandId, "First cake");
    await pack(brandId, "Second cake");
    const { link } = await studio.services.clients.make(brandId, OWNER);
    expect(new URL(link).pathname).toMatch(/^\/client\/[A-Za-z0-9_-]{43}$/);
    const shown = await view(link);
    expect(shown).toMatchObject({ brand: "WonGi" });
    expect(shown?.packs.map((entry) => entry.product)).toEqual(["Second cake", "First cake"]);
    expect(shown?.packs[0]).toMatchObject({ version: 1, ads: [{ formats: ["jpg"] }] });
  });

  it("holds no pack of another brand and no example", async () => {
    await pack(brandId, "Own cake");
    await pack(otherId, "Their cake");
    await pack(brandId, "Example cake", true);
    const { link } = await studio.services.clients.make(brandId, OWNER);
    expect((await view(link))?.packs.map((entry) => entry.product)).toEqual(["Own cake"]);
  });

  it("gives away no id of the studio, no key of a picture and no token", async () => {
    const made = await pack(brandId, "Own cake");
    const { link } = await studio.services.clients.make(brandId, OWNER);
    // A signed picture address names the picture's place in the store, as on a pack page today. It opens that one picture for an hour and nothing else.
    const shown = JSON.stringify(await view(link), (key, value) => (key === "viewUrl" ? "" : value));
    for (const secret of [made.packId, brandId, token(link), token(made.link), hashToken(token(link)), '"key"', "tokenHash", "imageId"]) expect(shown).not.toContain(secret);
    expect((await view(link))?.packs[0]?.ref).toBe(packRef(made.packId));
    // Only the hash of the token is kept.
    expect(stored()).not.toContain(token(link));
    expect(stored()).toContain(hashToken(token(link)));
  });

  it("opens a page with no pack for a brand that has none yet", async () => {
    const { link } = await studio.services.clients.make(brandId, OWNER);
    expect(await view(link)).toEqual({ brand: "WonGi", packs: [] });
  });

  it("is made once: a second make is refused, because the studio cannot show the first again", async () => {
    await studio.services.clients.make(brandId, OWNER);
    await expect(studio.services.clients.make(brandId, OWNER)).rejects.toThrow(/has a client link/);
    await expect(studio.services.clients.make("no-such-brand", OWNER)).rejects.toThrow(/no brand/);
  });

  it("opens nothing once it is replaced, and the new one opens the page", async () => {
    await pack(brandId, "Own cake");
    const first = await studio.services.clients.make(brandId, OWNER);
    const second = await studio.services.clients.replace(brandId, OWNER);
    expect(await view(first.link)).toBeUndefined();
    expect((await view(second.link))?.packs).toHaveLength(1);
    expect(stored()).not.toContain(hashToken(token(first.link)));
    await expect(studio.services.clients.replace(otherId, OWNER)).rejects.toThrow(/no client link that is on/);
  });

  it("opens nothing once it is turned off, and making a link again gives a new one", async () => {
    const first = await studio.services.clients.make(brandId, OWNER);
    expect(await studio.services.clients.turnOff(brandId, OWNER)).toMatchObject({ brandId, state: "off" });
    expect(await view(first.link)).toBeUndefined();
    expect(await studio.services.packs.clientLink(brandId)).toMatchObject({ state: "off" });
    await expect(studio.services.clients.turnOff(brandId, OWNER)).rejects.toThrow(/no client link that is on/);
    await expect(studio.services.clients.replace(brandId, OWNER)).rejects.toThrow(/no client link that is on/);
    const again = await studio.services.clients.make(brandId, OWNER);
    expect(again.link).not.toBe(first.link);
    expect(await view(again.link)).toMatchObject({ brand: "WonGi" });
    expect(await view(first.link)).toBeUndefined();
  });

  it("does not open for a link row whose record was turned off, even while the row is still there", async () => {
    const { link } = await studio.services.clients.make(brandId, OWNER);
    // A turn-off that stopped halfway: the record says off, the link row was not deleted yet.
    await studio.table.put({ pk: "CLIENTLINK", sk: brandId, brandId, state: "off", at: "2026-11-22T00:00:00.000Z", by: OWNER });
    expect(await view(link)).toBeUndefined();
  });

  it("gives nothing for a token of the wrong shape, an unknown token and a pack's token, and a client token opens no pack page", async () => {
    const made = await pack(brandId, "Own cake");
    const { link } = await studio.services.clients.make(brandId, OWNER);
    for (const wrong of ["", "short", "x".repeat(43), `${token(link)}x`, "../../etc/passwd", token(made.link)]) expect(await studio.services.clients.view(wrong)).toBeUndefined();
    expect(await studio.services.pack.view(token(link))).toBeUndefined();
    expect(await studio.services.pack.download(token(link), 0)).toBeUndefined();
    expect(await studio.services.pack.upload(token(link), { name: "a.csv", type: "text/csv", bytes: 10 })).toBeUndefined();
    // The owner's list of packs is not confused by a client link.
    expect(await studio.services.pack.summaries()).toHaveLength(1);
  });

  it("reaches one pack of its own brand by the pack's name on the page, and no other", async () => {
    const own = await pack(brandId, "Own cake");
    const theirs = await pack(otherId, "Their cake");
    const example = await pack(brandId, "Example cake", true);
    const { link } = await studio.services.clients.make(brandId, OWNER);
    const find = (ref: string, by = token(link)) => studio.services.clients.find(by, ref);
    expect((await find(packRef(own.packId)))?.pack.id).toBe(own.packId);
    for (const ref of [packRef(theirs.packId), packRef(example.packId), own.packId, "", "g".repeat(24), "0".repeat(24)]) expect(await find(ref)).toBeUndefined();
    expect(await find(packRef(own.packId), token(own.link))).toBeUndefined();
    expect(await find(packRef(own.packId), "x".repeat(43))).toBeUndefined();
  });

  it("is listed for the owner without its hash", async () => {
    await studio.services.clients.make(brandId, OWNER);
    const links = await studio.services.packs.clientLinks();
    expect(links).toEqual([{ brandId, state: "on", at: expect.any(String), by: OWNER }]);
    expect(await studio.services.packs.clientLink(otherId)).toBeUndefined();
  });
});
