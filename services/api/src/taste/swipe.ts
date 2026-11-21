import { createHash, randomUUID } from "node:crypto";
import type { SwipeItem } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const PK = "SWIPE";

export type SwipeInput = Omit<SwipeItem, "id" | "addedAt"> & { addedAt?: string };

/** References the owner saved: work worth learning from, each with one line on why. */
export class SwipeFile {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async add(input: SwipeInput): Promise<SwipeItem> {
    const id = input.originId ? createHash("sha256").update(input.originId).digest("hex").slice(0, 16) : randomUUID();
    const item: SwipeItem = { ...input, id, addedAt: input.addedAt ?? this.now().toISOString() };
    await this.table.put({ pk: PK, sk: id, ...item });
    return item;
  }

  /** Items that hold every word given, newest first. No words gives the newest items. */
  async search(words = "", limit = 20): Promise<SwipeItem[]> {
    const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
    const items = await this.table.query<Item & SwipeItem>(PK);
    return items
      .map((item) => record<SwipeItem>(item))
      .filter((item) => {
        const text = `${item.title} ${item.why} ${item.source} ${(item.tags ?? []).join(" ")}`.toLowerCase();
        return wanted.every((word) => text.includes(word));
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }
}
