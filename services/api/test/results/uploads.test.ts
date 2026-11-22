import type { MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csvTable, csvText, isSentType } from "../../src/results/uploads.js";
import { createStudio, type Studio } from "../helpers/deps.js";
import { JPEG, PNG } from "../helpers/pictures.js";

const OWNER = "owner@example.com";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });
const bytes = (text: string) => new TextEncoder().encode(text);
// The first bytes of a Windows program, of a ZIP (which a spreadsheet file is) and of a PDF.
const PROGRAM = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

let studio: Studio;
let pack: NonNullable<Awaited<ReturnType<Studio["services"]["packs"]["get"]>>>;

beforeEach(async () => {
  studio = await createStudio();
  const brandId = (await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: null, palette: [], fonts: [], savedBy: OWNER })).id;
  const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: JPEG.length }]);
  await studio.pictures.put(`carried/${carryId}/0`, JPEG, "image/jpeg");
  const made = await studio.services.pack.carry(OWNER, { carryId, brandId, product: "Cake", ads: [{ adName: "a11_cake", picture: 0, variants: [variant("A"), variant("B")], why: "Why.", claims: [] }], launchPlan: ["Run."] });
  pack = (await studio.services.packs.get(made.packId)) as typeof pack;
});

/** A client asks for a place for a file and then sends these bytes there. */
async function sent(name: string, type: string, body: Uint8Array | undefined) {
  // Each file has its own second, so the list has one order.
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const { upload } = await studio.services.pack.uploadTo(pack, { name, type, bytes: body?.length ?? 100 });
  const [kept] = (await studio.services.results.uploads(pack.id)).filter((entry) => entry.id === upload.id);
  if (!kept) throw new Error("no upload");
  if (body) await studio.pictures.put(kept.key, body, type);
  return kept;
}

describe("what a file is", () => {
  it("is told by its bytes and not by its name", () => {
    expect(isSentType("image/png", PNG)).toBe(true);
    expect(isSentType("image/jpeg", JPEG)).toBe(true);
    expect(isSentType("image/png", JPEG)).toBe(false);
    expect(isSentType("image/jpeg", PROGRAM)).toBe(false);
    expect(isSentType("image/png", bytes("<svg onload=alert(1)>"))).toBe(false);
    expect(isSentType("text/csv", bytes("Ad name,Clicks\na11,12\n"))).toBe(true);
    for (const body of [PROGRAM, ZIP, PNG, JPEG, new Uint8Array([0xff, 0xfe, 0x41, 0x00])]) expect(isSentType("text/csv", body)).toBe(false);
    expect(csvText(new Uint8Array([0xc3, 0x28]))).toBeUndefined();
  });
});

describe("a CSV as a table", () => {
  it("reads quotes, commas and line ends, and keeps a formula as plain characters", () => {
    expect(csvTable('\uFEFFAd name,"Amount spent (SGD)",Note\r\na11_tof,"1,204.50","He said ""yes"""\n\n=HYPERLINK("https://evil.example"),@SUM(A1),+1\n')).toEqual({
      rows: [
        ["Ad name", "Amount spent (SGD)", "Note"],
        ["a11_tof", "1,204.50", 'He said "yes"'],
        ['=HYPERLINK("https://evil.example")', "@SUM(A1)", "+1"],
      ],
      cut: false,
    });
    expect(csvTable("")).toEqual({ rows: [], cut: false });
    expect(csvTable("one line, no end")).toEqual({ rows: [["one line", " no end"]], cut: false });
  });

  it("cuts a table that is too long, too wide or has a cell that is too large, and says so", () => {
    const long = csvTable(Array.from({ length: 600 }, (_, n) => `row ${n},1`).join("\n"));
    expect(long.rows).toHaveLength(500);
    expect(long.cut).toBe(true);
    const wide = csvTable(Array.from({ length: 80 }, (_, n) => `c${n}`).join(","));
    expect(wide.rows[0]).toHaveLength(60);
    expect(wide.cut).toBe(true);
    const large = csvTable(`${"x".repeat(5000)},ok`);
    expect(large.rows[0]).toEqual(["x".repeat(300), "ok"]);
    expect(large.cut).toBe(true);
  });

  it("holds half a million characters at most, so one answer stays small enough to send", () => {
    // 500 rows of 60 full cells are 9 million characters: within every other limit, and too large to send.
    const line = Array.from({ length: 60 }, () => "y".repeat(300)).join(",");
    const table = csvTable(Array.from({ length: 500 }, () => line).join("\n"));
    expect(table.cut).toBe(true);
    const chars = table.rows.flat().join("").length;
    expect(chars).toBeLessThanOrEqual(500_000);
    expect(chars).toBeGreaterThan(499_000);
    expect(JSON.stringify(table).length).toBeLessThan(1_000_000);
  });
});

describe("a file a client sent", () => {
  it("is kept when it is what it was sent as, and the owner hears of it once it is checked", async () => {
    const upload = await sent("week-1.png", "image/png", PNG);
    expect(studio.activities).toEqual([]);
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "checked" });
    expect(studio.activities).toMatchObject([{ brand: "WonGi", kind: "file" }]);
    expect(await studio.services.uploads.list(pack.id)).toMatchObject([{ id: upload.id, state: "checked" }]);
    const [kept] = await studio.services.uploads.list(pack.id);
    expect(await studio.services.uploads.forAgent(kept!)).toEqual({ viewUrl: expect.stringContaining("?signed=1") });
    // Saying it twice changes nothing and sends no second notice.
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "checked" });
    expect(studio.activities).toHaveLength(1);
  });

  it("is deleted when it is something else under a picture's or a CSV's name, and cannot be opened", async () => {
    for (const [name, type, body] of [
      ["shot.png", "image/png", PROGRAM],
      ["shot.jpg", "image/jpeg", bytes("<html><script>alert(1)</script></html>")],
      ["export.csv", "text/csv", ZIP],
      ["export.csv", "text/csv", PROGRAM],
    ] as const) {
      const upload = await sent(name, type, body);
      expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "refused" });
      expect(studio.pictures.files.has(upload.key)).toBe(false);
      expect(await studio.services.uploads.forAgent((await studio.services.uploads.list(pack.id)).find((entry) => entry.id === upload.id)!)).toEqual({});
      await expect(studio.services.uploads.table(pack.id, upload.id)).rejects.toThrow(/did not keep this file/);
    }
    expect(studio.activities).toEqual([]);
    const { packs } = { packs: await studio.services.pack.summaries() };
    expect(packs[0]?.uploads.every((entry) => entry.state === "refused" && !("openUrl" in entry) && !("key" in entry))).toBe(true);
  });

  it("is read by the studio also when the sender never said it was sent", async () => {
    const good = await sent("week-1.csv", "text/csv", bytes("Ad name,Clicks\na11_cake,12\n"));
    const bad = await sent("week-2.png", "image/png", PROGRAM);
    expect(await studio.services.uploads.list(pack.id)).toMatchObject([{ id: good.id, state: "checked" }, { id: bad.id, state: "refused" }]);
    expect(studio.pictures.files.has(bad.key)).toBe(false);
    expect(await studio.services.uploads.table(pack.id, good.id)).toEqual({ rows: [["Ad name", "Clicks"], ["a11_cake", "12"]], cut: false });
    // A CSV has no address in the owner's list: the dashboard shows its table.
    expect((await studio.services.pack.summaries())[0]?.uploads[0]).not.toHaveProperty("openUrl");
  });

  it("waits for a file that is not there yet, and gives it up after ten minutes", async () => {
    const upload = await sent("week-1.png", "image/png", undefined);
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "waiting" });
    expect((await studio.services.uploads.list(pack.id))[0]).not.toHaveProperty("state");
    studio.clock.now = new Date(studio.clock.now.getTime() + 11 * 60 * 1000);
    expect(await studio.services.uploads.list(pack.id)).toMatchObject([{ state: "missing" }]);
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "refused" });
    expect(await studio.services.uploads.forAgent((await studio.services.uploads.list(pack.id))[0]!)).toEqual({});
  });

  it("keeps its own copy of a checked file, so a file sent later to the same address stands in for nothing", async () => {
    const upload = await sent("week-1.png", "image/png", PNG);
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "checked" });
    const [kept] = await studio.services.uploads.list(pack.id);
    expect(kept?.key).not.toBe(upload.key);
    expect(kept?.key.startsWith("quarantine/")).toBe(false);
    expect(studio.pictures.files.has(upload.key)).toBe(false);
    // The signed address still takes a file for some minutes. The sender uses it again, with a program.
    await studio.pictures.put(upload.key, PROGRAM, "image/png");
    const [again] = await studio.services.uploads.list(pack.id);
    expect(again?.key).toBe(kept?.key);
    expect(studio.pictures.files.get(kept!.key)?.body).toEqual(PNG);
  });

  it("reads the file again when the save of its record failed, and does not lose it", async () => {
    const upload = await sent("week-1.png", "image/png", PNG);
    const settle = vi.spyOn(studio.services.results, "settle").mockRejectedValueOnce(new Error("the table is away"));
    await expect(studio.services.uploads.done(pack, upload.id)).rejects.toThrow("the table is away");
    expect(studio.pictures.files.has(upload.key)).toBe(true);
    settle.mockRestore();
    studio.clock.now = new Date(studio.clock.now.getTime() + 11 * 60 * 1000);
    expect(await studio.services.uploads.list(pack.id)).toMatchObject([{ id: upload.id, state: "checked" }]);
    expect(studio.pictures.files.has(upload.key)).toBe(false);
  });

  it("tells the owner of a file also when the owner's list read it before the client's page said it was sent", async () => {
    const upload = await sent("week-1.png", "image/png", PNG);
    await studio.services.uploads.list(pack.id);
    expect(studio.activities).toMatchObject([{ brand: "WonGi", kind: "file" }]);
    expect(await studio.services.uploads.done(pack, upload.id)).toEqual({ state: "checked" });
    expect(studio.activities).toHaveLength(1);
  });

  it("gives an agent the rows of a CSV and never the file", async () => {
    await sent("week-1.csv", "text/csv", bytes("Ad name,Clicks\n=cmd|' /C calc'!A0,12\n"));
    const [kept] = await studio.services.uploads.list(pack.id);
    expect(await studio.services.uploads.forAgent(kept!)).toEqual({ rowsWith: "results_table" });
    expect(await studio.services.uploads.table(pack.id, kept!.id)).toEqual({ rows: [["Ad name", "Clicks"], ["=cmd|' /C calc'!A0", "12"]], cut: false });
  });

  it("neither opens nor deletes a file of a type the studio took once and takes no more", async () => {
    const old = await studio.services.results.addUpload(pack.id, { name: "week-1.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as never, bytes: 4, packVersion: 1 }, (id) => `quarantine/packs/${pack.id}/${id}.xlsx`);
    await studio.pictures.put(old!.key, bytes("PK\u0003\u0004"), "application/octet-stream");
    expect(await studio.services.uploads.list(pack.id)).toMatchObject([{ id: old!.id, state: "refused" }]);
    expect(studio.pictures.files.has(old!.key)).toBe(true);
    expect(studio.activities).toEqual([]);
  });

  it("refuses a file the pack does not have, and a table of a picture", async () => {
    await expect(studio.services.uploads.done(pack, "nope")).rejects.toThrow(/no such file/);
    const picture = await sent("week-1.png", "image/png", PNG);
    await expect(studio.services.uploads.table(pack.id, picture.id)).rejects.toThrow(/Only a CSV has a table/);
  });
});
