import { randomUUID } from "node:crypto";
import type { BatchKind, Reference } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const PK = "REFS";
export const REFERENCES_MAX = 60;

/** The owner's reference ads: the bar a writer and a critic hold new work against. */
export class References {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async add(input: Omit<Reference, "id" | "addedAt">): Promise<Reference> {
    const saved: Reference = { ...input, id: randomUUID(), addedAt: this.now().toISOString() };
    await this.table.put({ pk: PK, sk: saved.id, ...saved });
    return saved;
  }

  /** The references of one kind of ad, oldest first, so the order is the same on every read. */
  async of(kind: BatchKind): Promise<Reference[]> {
    const items = await this.table.query<Item & Reference>(PK);
    return items
      .map((item) => record<Reference>(item))
      .filter((reference) => reference.kinds.includes(kind))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
  }

  async count(): Promise<number> {
    return (await this.table.query(PK)).length;
  }
}
