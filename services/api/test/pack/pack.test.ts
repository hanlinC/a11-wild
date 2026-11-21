import type { BatchImage } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { loggedPath } from "../../src/app.js";
import { RULES_VERSION } from "../../src/houserules.js";
import { hashToken } from "../../src/pack/service.js";
import { approvedClient, callTool, createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";
import { pickedBatch } from "../helpers/picked.js";

const rules = { rulesVersion: RULES_VERSION };
const text = (headline = "The skin, done right") => ({
  primary: "The skin is the best part. We fry it until it curls, then coat every piece in salted egg. Order yours today.",
  headline,
  description: "Order the salted egg fish skin",
  cta: "Order Now",
});
const WHY = ["idea-1", "idea-2", "idea-3"].map((ideaId) => ({ ideaId, why: "Buyers say the skin is what they come back for; the ad says so." }));
const PLAN = ["Put all three ads in one ad set.", "Run them for 72 hours.", "Stop an ad that is under the account's usual CTR after 72 hours."];

let studio: Studio;
let batchId: string;
/** The delivered picture of each idea, as the board would report it. A test changes it to stand for a final made again. */
let delivered: Record<string, string | undefined>;

const image = (id: string): BatchImage => ({ id, batchId, kind: "typeset", key: `batches/${batchId}/${id}.png`, createdAt: "2026-11-21T12:00:00.000Z" });
const state = async (to: "done" | "finals") => studio.table.put({ pk: "BATCH", sk: batchId, ...(await studio.services.batches.get(batchId)), state: to });
const approve = async (headline?: string) => {
  const saved = await callTool(studio, "meta_save", { ...rules, batchId, ads: WHY.map(({ ideaId }) => ({ ideaId, variants: [text(headline), text("Skin first")] })) });
  await callTool(studio, "meta_approve", { ...rules, batchId, ads: saved.value.saved.map(({ ideaId, version }: { ideaId: string; version: number }) => ({ ideaId, version, ownerSaid: "yes" })) });
};
const publish = (extra: object = {}, as: { sub?: string } = {}) => callTool(studio, "pack_publish", { ...rules, batchId, why: WHY, launchPlan: PLAN, ...extra }, as);
const open = (link: string) => studio.app.request(new URL(link).pathname.replace("/c/", "/api/pack/"));

let batchOf: Awaited<ReturnType<typeof pickedBatch>> | undefined;

/** A picked batch. A second one in a test is the same brand's next batch. */
async function setUp(kind: "v1" | "v2" = "v2", create: { test?: true } = {}) {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  batchOf = await pickedBatch(studio, kind, create, batchOf);
  batchId = batchOf.batch.id;
  delivered = { "idea-1": "final-1", "idea-2": "final-2", "idea-3": "final-3" };
  studio.services.board.finals = async () =>
    Object.entries(delivered).map(([ideaId, id]) => ({
      ideaId,
      pick: { ideaId, imageId: `${ideaId}-d1`, ownerSaid: "this one", at: "", by: "owner@example.com" },
      missing: id ? [] : [`a final of ${ideaId} with no D item (the newest has D2)`],
      ...(id ? { delivered: image(id) } : {}),
    }));
}

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  batchOf = undefined;
  await setUp();
  await approve();
  await state("done");
});

describe("pack_publish", () => {
  it("makes one link, keeps only the hash of its token, and names each ad", async () => {
    const made = (await publish()).value;
    const token = new URL(made.link).pathname.split("/").at(-1)!;
    expect(made.link).toMatch(/^https:\/\/studio\.example\.com\/c\/[A-Za-z0-9_-]{43}$/);
    expect(made.version).toMatchObject({ version: 1, launchPlan: PLAN, by: "owner@example.com" });
    expect(made.version.ads.map((ad: { adName: string }) => ad.adName)).toEqual(["a11_W47_wongi_b01_tof_c1_v1", "a11_W47_wongi_b01_mof_c2_v1", "a11_W47_wongi_b01_bof_c3_v1"]);
    expect(made.version.ads[0]).toMatchObject({ imageId: "final-1", words: { headline: "THE SKIN IS | THE BEST PART." }, meta: { version: 1 }, why: WHY[0]!.why });
    const stored = JSON.stringify([...studio.table.items.values()]);
    expect(stored).not.toContain(token);
    expect(stored).toContain(hashToken(token));
    expect(JSON.stringify((await callTool(studio, "pack_get", { batchId })).value)).not.toMatch(/tokenHash|[a-f0-9]{64}/);
    expect(await publish()).toMatchObject({ ok: false, error: expect.stringMatching(/has a pack.*pack_update/) });
  });

  it("finishes a publish that stopped after the pack row and before its first version", async () => {
    await studio.services.packs.create({ batchId, tokenHash: "0".repeat(64), current: 1, createdAt: "2026-11-21T12:00:00.000Z", by: "owner@example.com" });
    const made = (await publish()).value;
    expect(made.version.version).toBe(1);
    expect((await open(made.link)).status).toBe(200);
    // The half-made link opens nothing, and a second publish is refused as before.
    expect([...studio.table.items.keys()].some((key) => key.includes("0".repeat(64)))).toBe(false);
    expect(await publish()).toMatchObject({ ok: false, error: expect.stringMatching(/has a pack/) });
  });

  it("never writes the token of a link into a log line", () => {
    expect(loggedPath(`/api/pack/${"a".repeat(43)}/uploads`)).toBe("/api/pack/<token>/uploads");
    expect(loggedPath(`/api/pack/${"a".repeat(43)}`)).toBe("/api/pack/<token>");
    expect(loggedPath("/api/packs")).toBe("/api/packs");
    expect(loggedPath("/api/batches/b1/board")).toBe("/api/batches/b1/board");
  });

  it("is the owner's alone", async () => {
    expect(await publish({}, { sub: "sub-member" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only the owner publishes/) });
  });

  it("refuses a batch that is not done, a failed final, a missing why and a missing plan", async () => {
    await state("finals");
    expect(await publish()).toMatchObject({ ok: false, error: expect.stringMatching(/finals.*batch_done/) });
    await state("done");
    delivered["idea-2"] = undefined;
    expect(await publish()).toMatchObject({ ok: false, error: expect.stringMatching(/final of idea-2 is not ready for a client.*D2/) });
    delivered["idea-2"] = "final-2";
    expect(await publish({ why: WHY.slice(0, 2) })).toMatchObject({ ok: false, error: expect.stringMatching(/one line of why for idea-3/) });
    expect(await publish({ launchPlan: undefined })).toMatchObject({ ok: false, error: expect.stringMatching(/launch plan/) });
    expect((await callTool(studio, "pack_get", { batchId })).value.pack).toBeNull();
  });

  it("refuses a test batch even when its state says done", async () => {
    await setUp("v2", { test: true });
    await approve();
    await state("done");
    expect(await publish()).toMatchObject({ ok: false, error: expect.stringMatching(/test batch/) });
  });

  it("carries a v1 picture with no words under the name wild", async () => {
    await setUp("v1");
    await approve();
    await state("done");
    const { ads } = (await publish()).value.version;
    expect(ads[0].adName).toBe("a11_W47_wongi_b02_wild_c1_v1");
    expect(ads[0].words).toBeUndefined();
  });
});

describe("the pack link", () => {
  it("shows that pack with no sign-in, with short picture links and nothing of the store", async () => {
    const { link } = (await publish()).value;
    const page = await open(link);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const view = await json(page);
    expect(view).toMatchObject({ brand: "WonGi", product: "Seaweed crisps", version: 1, launchPlan: PLAN });
    expect(view.ads[0]).toMatchObject({ adName: "a11_W47_wongi_b01_tof_c1_v1", stage: "tof", viewUrl: expect.any(String) });
    expect(JSON.stringify(view)).not.toMatch(/"key"|"imageId"|"ideaId"|batchId|owner@example\.com|ownerSaid/);
  });

  it("answers a wrong, a badly shaped and a replaced token alike with 404", async () => {
    const { link } = (await publish()).value;
    const wrong = `${link.slice(0, -1)}${link.endsWith("A") ? "B" : "A"}`;
    for (const path of [wrong, "https://studio.example.com/c/short", `https://studio.example.com/c/${"a".repeat(43)}`]) {
      const page = await open(path);
      expect(page.status).toBe(404);
      expect(await json(page)).toEqual({ error: "not_found" });
    }
    const next = (await callTool(studio, "pack_relink", { batchId })).value.link;
    expect(next).not.toBe(link);
    expect((await open(link)).status).toBe(404);
    expect((await open(next)).status).toBe(200);
  });
});

describe("pack_update", () => {
  it("puts a new version in the same link, renames only the ad that changed, and keeps the old content", async () => {
    const { link } = (await publish()).value;
    delivered["idea-2"] = "final-2b";
    const second = (await callTool(studio, "pack_update", { ...rules, batchId })).value.version;
    expect(second).toMatchObject({ version: 2, launchPlan: PLAN });
    expect(second.ads.map((ad: { adName: string }) => ad.adName)).toEqual(["a11_W47_wongi_b01_tof_c1_v1", "a11_W47_wongi_b01_mof_c2_v2", "a11_W47_wongi_b01_bof_c3_v1"]);
    expect(second.ads[1]).toMatchObject({ imageId: "final-2b", why: WHY[1]!.why });
    expect((await json(await open(link))).version).toBe(2);

    // Text the owner approved since then goes in the same way, under a new name for every ad it changed.
    await approve("Crisp to the last piece");
    const third = (await callTool(studio, "pack_update", { ...rules, batchId, launchPlan: ["Run them for 48 hours."] })).value.version;
    expect(third.ads.map((ad: { adName: string }) => ad.adName)).toEqual(["a11_W47_wongi_b01_tof_c1_v3", "a11_W47_wongi_b01_mof_c2_v3", "a11_W47_wongi_b01_bof_c3_v3"]);
    expect(third.launchPlan).toEqual(["Run them for 48 hours."]);

    const kept = (await callTool(studio, "pack_get", { batchId })).value;
    expect(kept.pack.current).toBe(3);
    expect(kept.versions.map((version: { version: number }) => version.version)).toEqual([1, 2, 3]);
    expect(kept.versions[0].ads[1].imageId).toBe("final-2");
  });

  it("is undone by pack_restore, which deletes nothing", async () => {
    const { link } = (await publish()).value;
    delivered["idea-1"] = "final-1b";
    await callTool(studio, "pack_update", { ...rules, batchId });
    expect((await callTool(studio, "pack_restore", { batchId, version: 1 })).value.pack).toMatchObject({ current: 1 });
    const view = await json(await open(link));
    expect(view.version).toBe(1);
    expect(view.ads[0].viewUrl).toContain("final-1.png");
    expect((await callTool(studio, "pack_get", { batchId })).value.versions).toHaveLength(2);
    expect(await callTool(studio, "pack_restore", { batchId, version: 7 })).toMatchObject({ ok: false, error: expect.stringMatching(/no version 7/) });
    // The next change is version 3: a number is never used twice.
    const third = (await callTool(studio, "pack_update", { ...rules, batchId })).value.version;
    expect(third.version).toBe(3);
    // The picture of version 2 is back under the name it got in version 2: one creative has one name, so its results stay together.
    expect(third.ads.map((ad: { adName: string }) => ad.adName)).toEqual(["a11_W47_wongi_b01_tof_c1_v2", "a11_W47_wongi_b01_mof_c2_v1", "a11_W47_wongi_b01_bof_c3_v1"]);
  });

  it("refuses text that is saved but not approved: the approved text stays in the pack", async () => {
    await publish();
    await callTool(studio, "meta_save", { ...rules, batchId, ads: [{ ideaId: "idea-1", variants: [text("New and unseen"), text("Skin first")] }] });
    const next = (await callTool(studio, "pack_update", { ...rules, batchId })).value.version;
    expect(next.ads[0]).toMatchObject({ adName: "a11_W47_wongi_b01_tof_c1_v1", meta: { version: 1 } });
  });
});

describe("the dashboard's list of packs", () => {
  it("needs a session and shows each pack with its versions, and no link", async () => {
    const { link } = (await publish()).value;
    expect((await studio.app.request("/api/packs")).status).toBe(401);
    const page = await studio.app.request("/api/packs", { headers: { cookie: await sessionCookie(studio) } });
    const { packs } = await json(page);
    expect(packs).toMatchObject([{ pack: { batchId, current: 1 }, brand: { name: "WonGi" }, versions: [{ version: 1 }] }]);
    expect(JSON.stringify(packs)).not.toContain(new URL(link).pathname.split("/").at(-1));
    expect(JSON.stringify(packs)).not.toContain("tokenHash");
  });
});
