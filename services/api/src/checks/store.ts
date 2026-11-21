import type { CheckItem, ImageChecks } from "@a11-wild/shared";
import { type Item, type Table } from "../store/table.js";
import { isDefect } from "./codes.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (imageId: string) => `CHECK#${imageId}`;

interface CheckRecord extends Item {
  imageId: string;
  /** What the agent saw. Each save replaces the list. */
  seen: CheckItem[];
  /** What a pixel tool measured, by tool name. Only that tool's next run changes its entry. */
  measured: Record<string, CheckItem | null>;
  looked: boolean;
  savedAt: string;
}

const view = (item: CheckRecord): ImageChecks => ({
  imageId: item.imageId,
  items: [...Object.values(item.measured).filter((entry): entry is CheckItem => entry !== null), ...item.seen],
  looked: item.looked,
  savedAt: item.savedAt,
});

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

  private async read(batchId: string, imageId: string): Promise<CheckRecord> {
    return (await this.table.get<CheckRecord>(pk(batchId), sk(imageId))) ?? { pk: pk(batchId), sk: sk(imageId), imageId, seen: [], measured: {}, looked: false, savedAt: "" };
  }

  /** Saves the agent's own look. It cannot add or remove an item that a tool measured. */
  async save(batchId: string, imageId: string, items: Omit<CheckItem, "tool">[]): Promise<ImageChecks> {
    const record = { ...(await this.read(batchId, imageId)), seen: items.map(({ code, note }) => ({ code, note })), looked: true, savedAt: this.now().toISOString() };
    await this.table.put(record);
    return view(record);
  }

  /** Saves what a pixel tool measured: its item when the picture failed, or a pass that clears that tool's earlier item. */
  async measure(batchId: string, imageId: string, tool: string, failed: Omit<CheckItem, "tool"> | null): Promise<ImageChecks> {
    const before = await this.read(batchId, imageId);
    const record = { ...before, measured: { ...before.measured, [tool]: failed ? { ...failed, tool } : null }, savedAt: this.now().toISOString() };
    await this.table.put(record);
    return view(record);
  }

  async get(batchId: string, imageId: string): Promise<ImageChecks | undefined> {
    const item = await this.table.get<CheckRecord>(pk(batchId), sk(imageId));
    return item ? view(item) : undefined;
  }

  /** The tools that have measured this picture, whatever they found. */
  async measuredBy(batchId: string, imageId: string): Promise<string[]> {
    return Object.keys((await this.read(batchId, imageId)).measured);
  }

  async all(batchId: string): Promise<Map<string, ImageChecks>> {
    const items = await this.table.query<CheckRecord>(pk(batchId));
    return new Map(items.filter((item) => item.sk.startsWith("CHECK#")).map((item) => [item.imageId, view(item)]));
  }
}
