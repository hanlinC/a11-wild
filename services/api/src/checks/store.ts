import type { CheckItem, ImageChecks } from "@a11-wild/shared";
import { type Item, type Table } from "../store/table.js";
import { isDefect } from "./codes.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (imageId: string) => `CHECK#${imageId}`;

/** What the agent saw in one picture. Each save replaces the list. */
interface SeenRecord extends Item {
  imageId: string;
  seen: CheckItem[];
  savedAt: string;
}

/** What one pixel tool measured on one pack of one picture: its item, or null for a pass. Each tool and each pack has its own row, so a save by the agent, by another tool, or a pass on another pack cannot overwrite it. */
interface MeasureRecord extends Item {
  imageId: string;
  tool: string;
  item: CheckItem | null;
  /** When the job that measured it was sent. An older job does not replace a newer one's result. */
  at: string;
  savedAt: string;
}

/** The first pack keeps the key a picture with one pack always had. */
const measureSk = (imageId: string, tool: string, pack = 1) => `MEASURE#${imageId}#${tool}${pack > 1 ? `#${pack}` : ""}`;

function view(imageId: string, seen: SeenRecord | undefined, measured: MeasureRecord[]): ImageChecks {
  return {
    imageId,
    items: [...measured.map((entry) => entry.item).filter((entry): entry is CheckItem => entry !== null), ...(seen?.seen ?? [])],
    looked: seen !== undefined,
    savedAt: [seen?.savedAt ?? "", ...measured.map((entry) => entry.savedAt)].sort().at(-1) ?? "",
  };
}

/** The first defect of a picture, or nothing. A picture with a defect never becomes a final. */
export const defectOf = (checks: ImageChecks | undefined): CheckItem | undefined => checks?.items.find((item) => isDefect(item.code));
/** One defect rejects a picture, and so do two faults. */
export const rejected = (checks: ImageChecks | undefined): boolean =>
  !!checks && (!!defectOf(checks) || checks.items.filter((item) => !isDefect(item.code)).length >= 2);

/** The D and F items of each draft and final. What a tool measured and what an agent saw are kept apart. */
export class CheckStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  private async rows(batchId: string): Promise<{ seen: SeenRecord[]; measured: MeasureRecord[] }> {
    const items = await this.table.query<Item>(pk(batchId));
    return {
      seen: items.filter((item): item is SeenRecord => item.sk.startsWith("CHECK#")),
      measured: items.filter((item): item is MeasureRecord => item.sk.startsWith("MEASURE#")),
    };
  }

  /** Saves the agent's own look. It cannot add or remove an item that a tool measured. */
  async save(batchId: string, imageId: string, items: Omit<CheckItem, "tool">[]): Promise<ImageChecks> {
    await this.table.put({ pk: pk(batchId), sk: sk(imageId), imageId, seen: items.map(({ code, note }) => ({ code, note })), savedAt: this.now().toISOString() });
    return (await this.get(batchId, imageId))!;
  }

  /** Saves what a pixel tool measured on one pack: its item when that pack failed, or a pass that clears that tool's earlier item on the same pack. `at` is when the job was sent. */
  async measure(batchId: string, imageId: string, tool: string, failed: Omit<CheckItem, "tool"> | null, at = this.now().toISOString(), pack = 1): Promise<ImageChecks> {
    const key = measureSk(imageId, tool, pack);
    const before = await this.table.get<MeasureRecord>(pk(batchId), key);
    if (!before || before.at <= at) {
      await this.table.put({ pk: pk(batchId), sk: key, imageId, tool, item: failed ? { ...failed, tool } : null, at, savedAt: this.now().toISOString() });
    }
    return (await this.get(batchId, imageId))!;
  }

  async get(batchId: string, imageId: string): Promise<ImageChecks | undefined> {
    return (await this.all(batchId)).get(imageId);
  }

  /** The tools that have measured this picture, whatever they found. */
  async measuredBy(batchId: string, imageId: string): Promise<string[]> {
    return [...new Set((await this.rows(batchId)).measured.filter((entry) => entry.imageId === imageId).map((entry) => entry.tool))];
  }

  async all(batchId: string): Promise<Map<string, ImageChecks>> {
    const { seen, measured } = await this.rows(batchId);
    const ids = new Set([...seen.map((entry) => entry.imageId), ...measured.map((entry) => entry.imageId)]);
    return new Map(
      [...ids].map((imageId) => [
        imageId,
        view(
          imageId,
          seen.find((entry) => entry.imageId === imageId),
          measured.filter((entry) => entry.imageId === imageId),
        ),
      ]),
    );
  }
}
