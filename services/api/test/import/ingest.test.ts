import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { fakeNet } from "../helpers/net.js";
import { PNG } from "../helpers/pictures.js";

const LOGO = "https://wongi.example/logo.png";
let studio: Studio;

beforeEach(async () => {
  studio = await createStudio({ net: fakeNet({ [LOGO]: { body: PNG, headers: { "content-type": "image/png" } } }) });
  await approvedClient(studio);
});

const line = (n: number, extra: object = {}) => ({ kind: "canon_line", originId: `rule-${String(n).padStart(2, "0")}`, text: `Rule ${n}.`, stage: "all", status: "active", ...extra });
const tenLines = Array.from({ length: 10 }, (_, i) => line(i + 1));

describe("the copy from a11-adgen", () => {
  it("makes one record for each of ten canon lines, each under its origin id", async () => {
    const reply = await callTool(studio, "import_ingest", { records: tenLines });
    expect(reply.value).toMatchObject({ saved: 10, already: 0, refused: [], counts: { canon_line: 10, taste: 0, swipe: 0, brand: 0 } });
    const kept = (await studio.table.query("IMPORT")).map((item) => item.sk);
    expect(kept).toContain("canon_line#rule-01");
    expect(kept).toHaveLength(10);
  });

  it("leaves ten records when the same ingest is sent twice", async () => {
    await callTool(studio, "import_ingest", { records: tenLines });
    const again = await callTool(studio, "import_ingest", { records: tenLines });
    expect(again.value).toMatchObject({ saved: 0, already: 10, counts: { canon_line: 10 } });
  });

  it("refuses and names a record with an unknown field, and keeps the others", async () => {
    const reply = await callTool(studio, "import_ingest", { records: [line(1), line(2, { hitRate: 0.4 }), { kind: "mood", originId: "m1" }, line(3)] });
    expect(reply.value.saved).toBe(2);
    expect(reply.value.refused).toEqual([
      { index: 1, originId: "rule-02", reason: expect.stringMatching(/hitRate/) },
      { index: 2, originId: "m1", reason: expect.any(String) },
    ]);
    expect(reply.value.counts.canon_line).toBe(2);
  });

  it("refuses a member, and keeps nothing", async () => {
    const reply = await callTool(studio, "import_ingest", { records: tenLines }, { sub: "sub-member" });
    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/Only the owner/) });
    expect(await studio.table.query("IMPORT")).toEqual([]);
  });

  it("builds one canon version from the active lines, once", async () => {
    const records = [line(1, { stage: "tof" }), line(2), line(3, { status: "retired" })];
    const first = await callTool(studio, "import_ingest", { records, buildCanon: true });
    expect(first.value.canon).toEqual({ version: 1, lines: 2, changed: true });
    const canon = await studio.services.canon.get();
    expect(canon.text).toBe("## Every ad\n- Rule 2.\n\n## Top of funnel: a stranger who has not heard of the brand\n- Rule 1.");
    expect(canon.reason).toMatch(/a11-adgen/);

    const second = await callTool(studio, "import_ingest", { records, buildCanon: true });
    expect(second.value.canon).toEqual({ version: 1, lines: 2, changed: false });
  });

  it("leaves a canon alone that the owner changed after the copy", async () => {
    const records = [line(1), line(2)];
    await callTool(studio, "import_ingest", { records, buildCanon: true });
    await studio.services.canon.save({ text: "One clever object.", reason: "My own words.", by: "owner" });

    const again = await callTool(studio, "import_ingest", { records, buildCanon: true });
    expect(again.value.canon).toEqual({ version: 2, lines: 2, changed: false });
    const more = await callTool(studio, "import_ingest", { records: [...records, line(4)], buildCanon: true });
    expect(more.value.canon).toMatchObject({ version: 2, changed: false, note: expect.stringMatching(/left it alone/) });
    expect((await studio.services.canon.get()).text).toBe("One clever object.");
  });

  it("copies taste rows and swipe items once, with their own times", async () => {
    const records = [
      { kind: "taste", originId: "pick:b1:tof", entry: "pick", at: "2026-11-08T03:00:00.000Z", ownerSaid: "this one", about: "Kaya toast, draft 2" },
      { kind: "swipe", originId: "55cf", title: "Oatside", why: "Only the shadow of the cup.", source: "owner pick", tags: ["mof"], addedAt: "2026-11-18T03:00:00.000Z" },
    ];
    await callTool(studio, "import_ingest", { records });
    await callTool(studio, "import_ingest", { records });
    const log = await studio.services.tasteLog.list();
    expect(log).toEqual([expect.objectContaining({ kind: "pick", at: "2026-11-08T03:00:00.000Z", ownerSaid: "this one", originId: "a11-adgen:taste:pick:b1:tof" })]);
    expect(await studio.services.swipe.search("shadow")).toEqual([expect.objectContaining({ title: "Oatside", addedAt: "2026-11-18T03:00:00.000Z" })]);
  });

  it("copies a brand kit and its logo from the logo's own public address", async () => {
    const brand = {
      kind: "brand",
      originId: "wongi",
      name: "WonGi",
      url: "https://wongi.example/",
      logoSourceUrl: LOGO,
      palette: [{ role: "primary", hex: "#ffd419", note: "brand yellow" }],
      fonts: ["Babydoll"],
      voice: "Playful.",
      neverSay: ["healthy"],
    };
    const reply = await callTool(studio, "import_ingest", { records: [brand, { ...brand, originId: "nologo", logoSourceUrl: "https://wongi.example/gone.png" }] });
    expect(reply.value).toMatchObject({ saved: 2, warnings: [expect.stringMatching(/logo could not be copied/)] });
    const kits = await studio.services.brands.brands();
    expect(kits).toHaveLength(2);
    const kit = kits.find((k) => k.originId === "a11-adgen:brand:wongi");
    expect(kit).toMatchObject({ name: "WonGi", palette: [{ role: "primary", hex: "#FFD419", note: "brand yellow" }], voice: "Playful.", neverSay: ["healthy"], logo: { sourceUrl: LOGO } });
    expect(kits.find((k) => k.originId === "a11-adgen:brand:nologo")?.logo).toBeNull();
  });
});
