import { createHash, randomUUID } from "node:crypto";
import type { TasteEntry } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const PK = "TASTE";

export type TasteInput = Omit<TasteEntry, "id" | "at"> & { at?: string };

/** What the owner picked, what he passed on and what he said, in his own words. Rows are only added. */
export class TasteLog {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** A record copied from elsewhere keeps one row however often it is sent, because its id comes from its origin. */
  async add(input: TasteInput): Promise<TasteEntry> {
    const at = input.at ?? this.now().toISOString();
    const id = input.originId ? createHash("sha256").update(input.originId).digest("hex").slice(0, 16) : randomUUID();
    const entry: TasteEntry = { ...input, id, at };
    const sk = input.originId ? `O#${id}` : `E#${at}#${id}`;
    await this.table.put({ pk: PK, sk, ...entry });
    return entry;
  }

  /** Newest first. `before` gives only what was said earlier than that moment. */
  async list(options: { limit?: number; before?: string } = {}): Promise<TasteEntry[]> {
    const items = await this.table.query<Item & TasteEntry>(PK);
    return items
      .map((item) => record<TasteEntry>(item))
      .filter((entry) => !options.before || entry.at < options.before)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, options.limit ?? 30);
  }
}
