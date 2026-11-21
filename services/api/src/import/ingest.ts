import { createHash } from "node:crypto";
import { PALETTE_ROLES } from "@a11-wild/shared";
import { z } from "zod";
import type { BrandStore } from "../brand/store.js";
import { copyPicture, type Pictures } from "../pictures/store.js";
import type { Table } from "../store/table.js";
import type { CanonStore } from "../taste/canon.js";
import type { TasteLog } from "../taste/log.js";
import type { SwipeFile } from "../taste/swipe.js";
import type { Net } from "../urlsafety.js";

const PK = "IMPORT";
/** The mark of the canon text that the copy last wrote. */
const CANON_BUILT = "CANON_BUILT";
const originId = z.string().min(1).max(200).describe("The record's id in a11-adgen.");
const iso = z.string().datetime({ offset: true });
const STAGES = ["all", "tof", "mof", "bof"] as const;

/** One record of each kind the copy knows. A field that is not named here refuses the record. */
const RECORD = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("canon_line"),
    originId,
    text: z.string().min(1).max(2000),
    stage: z.enum(STAGES),
    status: z.enum(["active", "retired"]),
    evidence: z.array(z.strictObject({ at: iso, source: z.string().max(300), quote: z.string().max(2000) })).max(20).default([]),
  }),
  z.strictObject({
    kind: z.literal("taste"),
    originId,
    entry: z.enum(["pick", "pass", "note"]),
    at: iso,
    ownerSaid: z.string().min(1).max(4000),
    about: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal("swipe"),
    originId,
    title: z.string().min(1).max(300),
    why: z.string().min(1).max(2000),
    source: z.string().min(1).max(200),
    sourceUrl: z.string().url().max(2000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(8).optional(),
    addedAt: iso,
  }),
  z.strictObject({
    kind: z.literal("brand"),
    originId,
    name: z.string().min(1).max(80),
    url: z.string().url().max(2000),
    logoSourceUrl: z.string().url().max(2000).optional(),
    palette: z
      .array(z.strictObject({ role: z.enum(PALETTE_ROLES), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/), note: z.string().max(200).optional() }))
      .max(12),
    fonts: z.array(z.string().min(1).max(60)).max(6),
    voice: z.string().max(3000).optional(),
    neverSay: z.array(z.string().min(1).max(300)).max(30).optional(),
    notes: z.string().max(6000).optional(),
  }),
]);
type ImportRecord = z.infer<typeof RECORD>;
export type ImportKind = ImportRecord["kind"];
export const IMPORT_KINDS = ["canon_line", "taste", "swipe", "brand"] as const satisfies readonly ImportKind[];

export interface IngestResult {
  saved: number;
  /** Records the studio already held from an earlier run. Nothing was changed for them. */
  already: number;
  refused: { index: number; originId?: string; reason: string }[];
  warnings: string[];
}

const stableId = (kind: ImportKind, origin: string) => createHash("sha256").update(`${kind}:${origin}`).digest("hex").slice(0, 32);
/** The fields that have a value, so that no key is stored as undefined. */
const optional = <T extends object>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

export interface ImportDeps {
  table: Table;
  canon: CanonStore;
  tasteLog: TasteLog;
  swipe: SwipeFile;
  brands: BrandStore;
  pictures: Pictures;
  net: Net;
  now: () => Date;
}

/** The one-time copy of the owner's taste from a11-adgen. Each record is kept once, under its a11-adgen id. */
export class Importer {
  constructor(private readonly deps: ImportDeps) {}

  async ingest(records: unknown[], by: string): Promise<IngestResult> {
    const result: IngestResult = { saved: 0, already: 0, refused: [], warnings: [] };
    for (const [index, raw] of records.entries()) {
      const parsed = RECORD.safeParse(raw);
      if (!parsed.success) {
        const origin = typeof (raw as { originId?: unknown })?.originId === "string" ? { originId: (raw as { originId: string }).originId } : {};
        const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`).join("; ");
        result.refused.push({ index, ...origin, reason: reason.slice(0, 500) });
        continue;
      }
      const record = parsed.data;
      const sk = `${record.kind}#${record.originId}`;
      if (await this.deps.table.get(PK, sk)) {
        result.already += 1;
        continue;
      }
      await this.keep(record, by, result.warnings);
      // The marker is written last: a record that failed half-way is done again on the next run.
      await this.deps.table.put({ pk: PK, sk, at: this.deps.now().toISOString(), ...(record.kind === "canon_line" ? { line: record } : {}) });
      result.saved += 1;
    }
    return result;
  }

  private async keep(record: ImportRecord, by: string, warnings: string[]): Promise<void> {
    const origin = `a11-adgen:${record.kind}:${record.originId}`;
    if (record.kind === "taste") {
      await this.deps.tasteLog.add({ kind: record.entry, at: record.at, ownerSaid: record.ownerSaid, savedBy: by, originId: origin, ...optional({ about: record.about }) });
    } else if (record.kind === "swipe") {
      await this.deps.swipe.add({
        title: record.title,
        why: record.why,
        source: record.source,
        addedAt: record.addedAt,
        savedBy: by,
        originId: origin,
        ...optional({ sourceUrl: record.sourceUrl, tags: record.tags }),
      });
    } else if (record.kind === "brand") {
      const id = stableId("brand", record.originId);
      let logo = null;
      if (record.logoSourceUrl) {
        try {
          const copy = await copyPicture({ url: record.logoSourceUrl, folder: `brands/${id}`, what: "The logo" }, this.deps.net, this.deps.pictures);
          logo = { key: copy.key, sourceUrl: copy.sourceUrl };
        } catch {
          warnings.push(`${record.name}: the logo could not be copied from its source page. The kit is saved without one; read the brand's page again to choose a logo.`);
        }
      }
      await this.deps.brands.saveBrand({
        id,
        name: record.name,
        url: record.url,
        logo,
        palette: record.palette.map(({ role, hex, note }) => ({ role, hex: hex.toUpperCase(), ...optional({ note }) })),
        fonts: record.fonts,
        savedBy: by,
        originId: origin,
        ...optional({ voice: record.voice, neverSay: record.neverSay, notes: record.notes }),
      });
    }
    // A canon line is kept in its marker; canonFromLines turns the lines into one canon version.
  }

  /** How many records of each kind the copy holds. */
  async counts(): Promise<Record<ImportKind, number>> {
    const items = await this.deps.table.query(PK);
    return Object.fromEntries(IMPORT_KINDS.map((kind) => [kind, items.filter((item) => item.sk.startsWith(`${kind}#`)).length])) as Record<ImportKind, number>;
  }

  /**
   * Writes the copied canon lines that are active as one canon version, once. The copy remembers the
   * text it wrote, so a second run leaves the canon alone, and a canon the owner wrote or changed is
   * never replaced by the copy.
   */
  async canonFromLines(by: string): Promise<{ version: number; lines: number; changed: boolean; note?: string }> {
    const items = await this.deps.table.query<{ pk: string; sk: string; line?: Extract<ImportRecord, { kind: "canon_line" }>; built?: string }>(PK);
    const lines = items.flatMap((item) => (item.line?.status === "active" ? [item.line] : []));
    const current = await this.deps.canon.get();
    if (lines.length === 0) return { version: current.version, lines: 0, changed: false };
    const titles: Record<(typeof STAGES)[number], string> = {
      all: "Every ad",
      tof: "Top of funnel: a stranger who has not heard of the brand",
      mof: "Middle of funnel: a buyer who is comparing",
      bof: "Bottom of funnel: a buyer who is ready",
    };
    const text = STAGES.flatMap((stage) => {
      const mine = lines.filter((line) => line.stage === stage).sort((a, b) => a.originId.localeCompare(b.originId));
      return mine.length ? [`## ${titles[stage]}\n${mine.map((line) => `- ${line.text}`).join("\n")}`] : [];
    })
      .join("\n\n")
      .trim();
    const mark = (value: string) => createHash("sha256").update(value).digest("hex");
    const built = items.find((item) => item.sk === CANON_BUILT)?.built;
    const unchanged = { version: current.version, lines: lines.length, changed: false };
    if (text === current.text) {
      if (built !== mark(text)) await this.deps.table.put({ pk: PK, sk: CANON_BUILT, built: mark(text) });
      return unchanged;
    }
    if (built === mark(text)) return unchanged;
    if (current.version > 0 && built !== mark(current.text)) {
      return { ...unchanged, note: "The canon was written or changed outside the copy, so the copy left it alone. Change it with canon_save." };
    }
    const saved = await this.deps.canon.save({ text, reason: `Copied ${lines.length} active canon lines from a11-adgen.`, by });
    await this.deps.table.put({ pk: PK, sk: CANON_BUILT, built: mark(saved.text) });
    return { version: saved.version, lines: lines.length, changed: true };
  }
}
