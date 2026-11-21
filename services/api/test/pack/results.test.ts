import type { BatchImage } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { approvedClient, callTool, createStudio, json, sessionCookie, type Studio } from "../helpers/deps.js";
import { pickedBatch } from "../helpers/picked.js";

const rules = { rulesVersion: RULES_VERSION };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const text = { primary: "The skin is the best part. We fry it until it curls. Order yours today.", headline: "The skin, done right", description: "Order the fish skin", cta: "Order Now" };
const AD = "a11_W47_wongi_b01_tof_c1_v1";

let studio: Studio;
let batchId: string;
let token: string;

const send = (file: object, to = token) =>
  studio.app.request(`/api/pack/${to}/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(file) });
const numbers = (extra: object = {}) => ({ batchId, adName: AD, from: "2026-11-23", to: "2026-11-25", impressions: 12000, clicks: 180, context: "Sales campaign, Singapore 25 to 44, Advantage+ placements, S$40 a day.", ...extra });

/** A done batch with a published pack. */
beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  batchId = (await pickedBatch(studio)).batch.id;
  const image = (id: string): BatchImage => ({ id, batchId, kind: "typeset", key: `batches/${batchId}/${id}.png`, createdAt: "2026-11-21T12:00:00.000Z" });
  const ideas = ["idea-1", "idea-2", "idea-3"];
  studio.services.board.finals = async () => ideas.map((ideaId) => ({ ideaId, pick: { ideaId, imageId: `${ideaId}-d1`, ownerSaid: "this one", at: "", by: "owner@example.com" }, missing: [], delivered: image(`final-${ideaId}`) }));
  await callTool(studio, "meta_save", { ...rules, batchId, ads: ideas.map((ideaId) => ({ ideaId, variants: [text, { ...text, headline: "Skin first" }] })) });
  await callTool(studio, "meta_approve", { ...rules, batchId, ads: ideas.map((ideaId) => ({ ideaId, version: 1, ownerSaid: "yes" })) });
  await studio.table.put({ pk: "BATCH", sk: batchId, ...(await studio.services.batches.get(batchId)), state: "done" });
  const made = await callTool(studio, "pack_publish", { ...rules, batchId, why: ideas.map((ideaId) => ({ ideaId, why: "Buyers come back for the skin." })), launchPlan: ["Run all three for 72 hours."] });
  token = new URL(made.value.link).pathname.split("/").at(-1)!;
});

describe("a results file through the pack link", () => {
  it("gets one link to a folder apart from the pictures, signed for its type and its size", async () => {
    const taken = await send({ name: "../../Ads Manager <week 1>.csv", type: "text/csv", bytes: 48_211 });
    expect(taken.status).toBe(200);
    const { upload, putUrl } = await json(taken);
    expect(upload.name).toBe("Ads Manager _week 1_.csv");
    expect(putUrl).toMatch(new RegExp(`^https://pictures\\.example/quarantine/packs/${batchId}/${upload.id}\\.csv\\?put=1&type=text%2Fcsv&bytes=48211$`));
    const kept = (await callTool(studio, "results_get", { batchId })).value.uploads;
    expect(kept).toMatchObject([{ id: upload.id, type: "text/csv", bytes: 48211, packVersion: 1, downloadUrl: expect.stringContaining("?download=") }]);
    expect(JSON.stringify(kept)).not.toContain('"key"');
  });

  it("refuses a file of another type, an empty one and one over 10 MB", async () => {
    for (const file of [
      { name: "run.exe", type: "application/x-msdownload", bytes: 2000 },
      { name: "page.html", type: "text/html", bytes: 2000 },
      { name: "shot.png", type: "image/png", bytes: 0 },
      { name: "shot.png", type: "image/png", bytes: 10_000_001 },
      { name: "shot.png", type: "image/png", bytes: 1.5 },
      { name: "shot.png", type: "image/png" },
    ]) {
      const refused = await send(file);
      expect(refused.status).toBe(400);
    }
    expect((await send({ name: "export.xlsx", type: XLSX, bytes: 10_000_000 })).status).toBe(200);
    expect((await callTool(studio, "results_get", { batchId })).value.uploads).toHaveLength(1);
  });

  it("takes 20 files and no more", async () => {
    for (let n = 0; n < 20; n++) expect((await send({ name: `shot-${n}.jpg`, type: "image/jpeg", bytes: 1000 })).status).toBe(200);
    const full = await send({ name: "one-more.jpg", type: "image/jpeg", bytes: 1000 });
    expect(full.status).toBe(400);
    expect((await json(full)).message).toMatch(/taken 20 files/);
  });

  it("answers a wrong token with 404 and keeps nothing", async () => {
    expect((await send({ name: "shot.png", type: "image/png", bytes: 1000 }, "a".repeat(43))).status).toBe(404);
    expect((await callTool(studio, "results_get", { batchId })).value.uploads).toEqual([]);
  });
});

describe("results_save", () => {
  it("ties the numbers to the ad name and its pack version, and counts the CTR itself", async () => {
    const { upload } = await json(await send({ name: "week-1.csv", type: "text/csv", bytes: 4000 }));
    const saved = (await callTool(studio, "results_save", numbers({ spend: 118.4, baselineCtr: 0.011, uploadId: upload.id }))).value.result;
    expect(saved).toMatchObject({ adName: AD, packVersion: 1, impressions: 12000, clicks: 180, ctr: 0.015, spend: 118.4, baselineCtr: 0.011, uploadId: upload.id, by: "owner@example.com" });
    expect((await callTool(studio, "results_get", { batchId })).value.results).toHaveLength(1);
  });

  it("refuses a name no pack version holds, impossible numbers and an unknown file", async () => {
    expect(await callTool(studio, "results_save", numbers({ adName: "a11_W47_wongi_b01_tof_c1_v9" }))).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`No version of this pack holds.*${AD}`)) });
    expect(await callTool(studio, "results_save", numbers({ clicks: 12001 }))).toMatchObject({ ok: false, error: expect.stringMatching(/more clicks than impressions/) });
    expect(await callTool(studio, "results_save", numbers({ to: "2026-11-20" }))).toMatchObject({ ok: false, error: expect.stringMatching(/before its first day/) });
    expect(await callTool(studio, "results_save", numbers({ uploadId: "nope" }))).toMatchObject({ ok: false, error: expect.stringMatching(/no uploaded file nope/) });
    expect((await callTool(studio, "results_save", numbers({ context: undefined }))).ok).toBe(false);
    expect((await callTool(studio, "results_get", { batchId })).value.results).toEqual([]);
  });

  it("keeps an ad that was not delivered, with a click rate of 0", async () => {
    expect((await callTool(studio, "results_save", numbers({ impressions: 0, clicks: 0 }))).value.result).toMatchObject({ impressions: 0, clicks: 0, ctr: 0 });
  });

  it("refuses a day that does not exist", async () => {
    expect((await callTool(studio, "results_save", numbers({ to: "2026-11-31" }))).ok).toBe(false);
    expect((await callTool(studio, "results_save", numbers({ from: "2026-02-30", to: "2026-03-02" }))).ok).toBe(false);
    expect((await callTool(studio, "results_get", { batchId })).value.results).toEqual([]);
  });

  it("shows the files and the numbers on the dashboard's list of packs", async () => {
    await send({ name: "week-1.png", type: "image/png", bytes: 4000 });
    await callTool(studio, "results_save", numbers());
    const { packs } = await json(await studio.app.request("/api/packs", { headers: { cookie: await sessionCookie(studio) } }));
    expect(packs[0]).toMatchObject({ uploads: [{ name: "week-1.png", downloadUrl: expect.any(String) }], results: [{ adName: AD, ctr: 0.015 }] });
  });
});
