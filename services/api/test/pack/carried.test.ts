import type { MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { CarriedAd, CarryInput } from "../../src/pack/service.js";
import { hashToken } from "../../src/pack/service.js";
import { savedProduct } from "../helpers/batch.js";
import { createStudio, type Studio } from "../helpers/deps.js";
import { JPEG, PNG } from "../helpers/pictures.js";

const OWNER = "owner@example.com";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });
const NOTE = "Example. This brand is not a client of the studio.";
const PLAN = ["Put all three ads in one ad set.", "Leave them unchanged for 72 hours."];

let studio: Studio;
let brandId: string;

const ad = (n: number, extra: Partial<CarriedAd> = {}): CarriedAd => ({
  adName: `a11_W45_brand_tof_c0${n}_v3`,
  stage: "tof",
  picture: n,
  variants: [variant("Wait, there's ten?"), variant("Ten in one")],
  why: "One cake holds ten flavours.",
  claims: [{ claim: "Ten flavours in one cake", quote: "10 uniquely flavoured cheesecakes", url: "https://brand.example/cake" }],
  ...extra,
});

/** Starts a carry and puts each file where its address points, as the owner's agent would. */
async function sent(files: Uint8Array[] = [JPEG, JPEG, JPEG]): Promise<string> {
  const { carryId, uploads } = await studio.services.pack.carryStart(files.map((file) => ({ type: file === PNG ? "image/png" : "image/jpeg", bytes: file.length })));
  for (const { picture, putUrl } of uploads) await studio.pictures.put(new URL(putUrl).pathname.slice(1), files[picture] as Uint8Array, "sent/type");
  return carryId;
}
const input = (carryId: string, extra: Partial<CarryInput> = {}): CarryInput => ({ carryId, brandId, product: "Ten-flavour cake", ads: [ad(0), ad(1), ad(2)], launchPlan: PLAN, ...extra });
const carry = async (extra: Partial<CarryInput> = {}, files?: Uint8Array[]) => studio.services.pack.carry(OWNER, input(await sent(files), extra));
const token = (link: string) => new URL(link).pathname.replace("/c/", "");
const stored = () => JSON.stringify([...studio.table.items.values()]);

beforeEach(async () => {
  studio = await createStudio();
  brandId = (await savedProduct(studio)).brand.id;
});

describe("a carried pack", () => {
  it("is saved as version 1 with the ad names as given, and opens through its own link", async () => {
    const made = await carry();
    expect(made.version).toMatchObject({ version: 1, by: OWNER, launchPlan: PLAN });
    const view = await studio.services.pack.view(token(made.link));
    expect(view).toMatchObject({ brand: "WonGi", product: "Ten-flavour cake", version: 1 });
    expect(view?.ads.map((entry) => entry.adName)).toEqual([0, 1, 2].map((n) => ad(n).adName));
    expect(view?.ads[0]).toMatchObject({ formats: ["jpg"], why: "One cake holds ten flavours.", meta: { version: 1 } });
    expect(view?.example).toBeUndefined();
    // The page gets no key of a picture and nothing of the studio's inside.
    expect(JSON.stringify(view)).not.toMatch(/"key"|imageId|ideaId|downloads|carried\/c_[^?]*"/);
    // Only the hash of the token is kept.
    expect(stored()).not.toContain(token(made.link));
    expect(stored()).toContain(hashToken(token(made.link)));
  });

  it("is listed for the owner with its brand, its product name and no batch", async () => {
    const made = await carry();
    const [summary] = await studio.services.pack.summaries();
    expect(summary).toMatchObject({ pack: { id: made.packId, source: "carried", brandId, current: 1 }, brand: { id: brandId, name: "WonGi" }, product: { name: "Ten-flavour cake" } });
    expect(summary?.pack).not.toHaveProperty("batchId");
    expect(summary?.pack).not.toHaveProperty("tokenHash");
    expect(summary?.versions[0]?.ads).toHaveLength(3);
  });

  it("is refused with no ad, with four ads, with an ad that has no reason, or with Meta text that has one variant", async () => {
    await expect(carry({ ads: [] })).rejects.toThrow(/one to three ads/);
    await expect(carry({ ads: [ad(0), ad(1), ad(2), ad(3)] })).rejects.toThrow(/one to three ads/);
    await expect(carry({ ads: [ad(0, { why: "  " })] })).rejects.toThrow(/why/);
    await expect(carry({ ads: [ad(0, { variants: [variant("One")] as unknown as CarriedAd["variants"] })] })).rejects.toThrow(/two variants/);
    await expect(carry({ launchPlan: [] })).rejects.toThrow(/launch plan/);
    expect(stored()).not.toContain("CPACK#");
  });

  it("is refused when two ads share a name, a name is no ad name, or a claim's source is not https", async () => {
    await expect(carry({ ads: [ad(0), ad(1, { adName: ad(0).adName })] })).rejects.toThrow(/same name/);
    await expect(carry({ ads: [ad(0, { adName: "../etc <b>" })] })).rejects.toThrow(/not an ad name/);
    for (const url of ["javascript:alert(1)", "http://brand.example/cake", "not an address"]) {
      await expect(carry({ ads: [ad(0, { claims: [{ claim: "c", quote: "q", url }] })] })).rejects.toThrow(/https/);
    }
    expect(stored()).not.toContain("CPACK#");
  });

  it("is refused when a file is missing, is over the size limit or is no PNG or JPEG by its first bytes, and nothing is saved", async () => {
    const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: 8 }]);
    await expect(studio.services.pack.carry(OWNER, input(carryId, { ads: [ad(0)] }))).rejects.toThrow(/Picture 0 is not there/);
    // The sender said JPEG; the first bytes say otherwise.
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(carry({ ads: [ad(0)] }, [html])).rejects.toThrow(/not a JPEG or a PNG/);
    const webp = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP"), 0]);
    await expect(carry({ ads: [ad(0)] }, [webp])).rejects.toThrow(/not a JPEG or a PNG/);
    const big = new Uint8Array(8_000_001);
    big.set(JPEG);
    const started = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: 8 }]);
    await studio.pictures.put(`carried/${started.carryId}/0`, big, "image/jpeg");
    await expect(studio.services.pack.carry(OWNER, input(started.carryId, { ads: [ad(0)] }))).rejects.toThrow(/over 8 MB/);
    await expect(carry({ ads: [ad(7)] })).rejects.toThrow(/Picture 7 is not there/);
    await expect(carry({ ads: [ad(0, { picture: 99 })] })).rejects.toThrow(/no picture 99/);
    expect(stored()).not.toContain("CPACK#");
  });

  it("takes only a carry the studio started, and each carry once", async () => {
    await sent();
    for (const carryId of ["c_not-a-uuid", "../batches/x", "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"]) {
      await expect(studio.services.pack.carry(OWNER, input(carryId))).rejects.toThrow(/not the id of a carry/);
    }
    const carryId = await sent();
    await studio.services.pack.carry(OWNER, input(carryId));
    await expect(studio.services.pack.carry(OWNER, input(carryId))).rejects.toThrow(/saved already/);
    await expect(studio.services.pack.carry(OWNER, input(await sent(), { brandId: "no-such-brand" }))).rejects.toThrow();
  });

  it("starts a carry only for JPEG and PNG files of a size the studio keeps", async () => {
    const start = (files: { type: string; bytes: number }[]) => studio.services.pack.carryStart(files);
    await expect(start([])).rejects.toThrow(/1 to 9 pictures/);
    await expect(start(Array.from({ length: 10 }, () => ({ type: "image/png", bytes: 10 })))).rejects.toThrow(/1 to 9 pictures/);
    await expect(start([{ type: "image/svg+xml", bytes: 10 }])).rejects.toThrow(/JPEG or a PNG/);
    await expect(start([{ type: "image/png", bytes: 8_000_001 }])).rejects.toThrow(/8 MB/);
    await expect(start([{ type: "image/png", bytes: 1.5 }])).rejects.toThrow(/8 MB/);
    const { carryId, uploads } = await start([{ type: "image/png", bytes: 12 }]);
    expect(carryId).toMatch(/^c_[0-9a-f-]{36}$/);
    expect(uploads).toEqual([{ picture: 0, putUrl: expect.stringContaining(`carried/${carryId}/0?put=1&type=image%2Fpng&bytes=12`) }]);
  });

  it("downloads a PNG as a PNG, though the address the picture was sent to has no ending", async () => {
    const made = await carry({}, [JPEG, PNG, JPEG]);
    const view = await studio.services.pack.view(token(made.link));
    expect(view?.ads.map((shown) => shown.formats)).toEqual([["jpg"], ["png"], ["jpg"]]);
    expect(await studio.services.pack.download(token(made.link), 1, "png")).toContain(`carried/${made.packId}/1?download=${ad(1).adName}.png`);
    expect(await studio.services.pack.download(token(made.link), 1)).toContain(`${ad(1).adName}.png`);
    expect(await studio.services.pack.download(token(made.link), 1, "jpg")).toBeUndefined();
  });

  it("downloads the picture the page shows, under the ad's name", async () => {
    const made = await carry();
    const url = await studio.services.pack.download(token(made.link), 1);
    expect(url).toContain(`carried/${made.packId}/1?download=${ad(1).adName}.jpg`);
    expect(await studio.services.pack.download(token(made.link), 1, "png")).toBeUndefined();
    expect(await studio.services.pack.download(token(made.link), 3)).toBeUndefined();
    expect(await studio.services.pack.download(token(made.link), -1)).toBeUndefined();
    expect(await studio.services.pack.download("x".repeat(43), 0)).toBeUndefined();
    expect(await studio.services.pack.download("short", 0)).toBeUndefined();
  });

  it("takes a results file and a restore like any pack, and gets a new link", async () => {
    const made = await carry();
    const taken = await studio.services.pack.upload(token(made.link), { name: "week-1.csv", type: "text/csv", bytes: 100 });
    expect(taken?.putUrl).toContain(`quarantine/packs/${made.packId}/`);
    expect((await studio.services.pack.summaries())[0]?.uploads).toHaveLength(1);
    expect(await studio.services.pack.restore(made.packId, 1)).toMatchObject({ current: 1 });
    await expect(studio.services.pack.restore(made.packId, 2)).rejects.toThrow(/no version 2/);
    const { link } = await studio.services.pack.relink(made.packId);
    expect(await studio.services.pack.view(token(made.link))).toBeUndefined();
    expect(await studio.services.pack.view(token(link))).toMatchObject({ product: "Ten-flavour cake" });
  });

  it("teaches the studio nothing: it has no batch, no pick and no line in the taste log", async () => {
    const before = [...studio.table.items.keys()];
    const made = await carry();
    const added = [...studio.table.items.keys()].filter((key) => !before.includes(key));
    // The pack, its one version and the way from its link: nothing else is written.
    expect(added).toHaveLength(3);
    expect(added.filter((key) => key.includes(`CPACK#${made.packId}`))).toHaveLength(2);
    expect(added.filter((key) => key.includes("PACKLINK"))).toHaveLength(1);
    expect(await studio.services.batches.list()).toEqual([]);
  });
});

describe("an example", () => {
  const example = {
    note: NOTE,
    comments: [
      { text: "Love the second one. Can we run it this week?" },
      { text: "Can the price sit a little higher?", adName: ad(2).adName, change: { what: "words" as const, status: "done" as const, version: 2 } },
    ],
  };
  // The page shows a clean picture; a download gives the marked copy.
  const marked = () => carry({ example, ads: [ad(0, { downloads: [3, 4] }), ad(1, { downloads: [5] }), ad(2)] }, [JPEG, JPEG, JPEG, JPEG, PNG, JPEG]);

  it("shows its note and its example comments", async () => {
    const view = await studio.services.pack.view(token((await marked()).link));
    expect(view?.example).toEqual(example);
    expect(view?.ads.map((entry) => entry.formats)).toEqual([["jpg", "png"], ["jpg"], ["jpg"]]);
  });

  it("downloads the marked copy, never the clean picture, and says so in the file's name", async () => {
    const made = await marked();
    const pack = studio.services.pack;
    expect(await pack.download(token(made.link), 0)).toContain(`carried/${made.packId}/3?download=example_${ad(0).adName}.jpg`);
    expect(await pack.download(token(made.link), 0, "png")).toContain(`carried/${made.packId}/4?download=example_${ad(0).adName}.png`);
    expect(await pack.download(token(made.link), 1, "jpg")).toContain(`carried/${made.packId}/5?download=example_`);
    expect(await pack.download(token(made.link), 1, "png")).toBeUndefined();
    expect(await pack.download(token(made.link), 0, "../../x")).toBeUndefined();
    // An ad with no marked copy still says "example" in the name.
    expect(await pack.download(token(made.link), 2)).toContain(`carried/${made.packId}/2?download=example_`);
  });

  it("takes no file, whatever asks", async () => {
    const made = await marked();
    await expect(studio.services.pack.upload(token(made.link), { name: "week-1.csv", type: "text/csv", bytes: 100 })).rejects.toThrow(/example\. It takes no file/);
    expect(stored()).not.toContain("UPLOAD#");
    expect([...studio.pictures.files.keys()].some((key) => key.startsWith("quarantine/"))).toBe(false);
  });

  it("is refused without its note, with too many or too long comments, or with a comment on an ad it does not hold", async () => {
    await expect(carry({ example: { note: " ", comments: [] } })).rejects.toThrow(/needs its note/);
    await expect(carry({ example: { note: NOTE, comments: Array.from({ length: 7 }, () => ({ text: "Hello" })) } })).rejects.toThrow(/6 example comments/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "x".repeat(1001) }] } })).rejects.toThrow(/1 to 1000 characters/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "" }] } })).rejects.toThrow(/1 to 1000 characters/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "Hello", adName: "a11_other" }] } })).rejects.toThrow(/not in this pack/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "Hello", change: { what: "words", status: "received" } }] } })).rejects.toThrow(/names the ad/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "Hello", adName: ad(0).adName, change: { what: "words", status: "received", version: 2 } }] } })).rejects.toThrow(/Only a done/);
    await expect(carry({ example: { note: NOTE, comments: [{ text: "Hello", adName: ad(0).adName, change: { what: "all" as never, status: "received" } }] } })).rejects.toThrow(/kind and a status/);
    expect(stored()).not.toContain("CPACK#");
  });

  it("is refused when two downloads of one ad have the same format", async () => {
    const plain = { note: NOTE, comments: [] };
    await expect(carry({ example: plain, ads: [ad(0, { downloads: [1, 2] })] })).rejects.toThrow(/one picture of each format/);
    await expect(carry({ example: plain, ads: [ad(0, { downloads: [] })] })).rejects.toThrow(/one picture of each format/);
    expect(stored()).not.toContain("CPACK#");
  });
});

describe("a pack saved before packs had a source", () => {
  it("reads as the pack of its batch and opens through its old link", async () => {
    const { pickedBatch } = await import("../helpers/picked.js");
    const { batch } = await pickedBatch(studio);
    const old = "o".repeat(43);
    // The rows as PR #8 wrote them: no id, no source, and the link names the batch.
    await studio.table.put({ pk: `BATCH#${batch.id}`, sk: "PACK", batchId: batch.id, tokenHash: hashToken(old), current: 1, createdAt: "2026-11-21T12:00:00.000Z", by: OWNER });
    await studio.table.put({ pk: "PACKLINK", sk: hashToken(old), batchId: batch.id });
    await studio.table.put({ pk: `BATCH#${batch.id}`, sk: "PACKV#0001", version: 1, ads: [{ ideaId: "idea-1", adName: "a11_W47_wongi_b01_tof_c1_v1", imageId: "final-1", key: `batches/${batch.id}/final-1.png`, meta: { version: 1, variants: [variant("A"), variant("B")] }, why: "Why.", claims: [] }], launchPlan: PLAN, at: "2026-11-21T12:00:00.000Z", by: OWNER });
    expect(await studio.services.packs.get(batch.id)).toMatchObject({ id: batch.id, source: "batch", batchId: batch.id });
    const view = await studio.services.pack.view(old);
    expect(view).toMatchObject({ brand: "WonGi", product: "Seaweed crisps", version: 1 });
    expect(view?.ads[0]?.formats).toEqual(["png"]);
    expect(await studio.services.pack.download(old, 0)).toContain(`batches/${batch.id}/final-1.png?download=a11_W47_wongi_b01_tof_c1_v1.png`);
    expect((await studio.services.pack.summaries())[0]).toMatchObject({ pack: { id: batch.id, source: "batch" }, product: { name: "Seaweed crisps" } });
  });
});
