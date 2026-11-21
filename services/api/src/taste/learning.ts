import { randomUUID } from "node:crypto";
import type { CanonScope, LearningRecord } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const PK = "LEARNING";
export const LEARNING_LIST_MAX = 100;

/**
 * What the studio saw and what it may teach. A record is only added, and it changes nothing by itself:
 * a lesson reaches a canon only through a proposal the owner approves, and a product fact only through facts_save.
 */
export class LearningStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async add(input: Omit<LearningRecord, "id" | "savedAt">): Promise<LearningRecord> {
    const saved: LearningRecord = { ...input, id: randomUUID().slice(0, 8), savedAt: this.now().toISOString() };
    await this.table.put({ pk: PK, sk: `R#${saved.id}`, ...saved });
    return saved;
  }

  async get(id: string): Promise<LearningRecord> {
    const item = await this.table.get<Item & LearningRecord>(PK, `R#${id}`);
    if (!item) throw new Refusal(`There is no learning record ${id}.`);
    return record<LearningRecord>(item);
  }

  /** Newest first. With scopes, only the records of those scopes. */
  async list(options: { scopes?: CanonScope[]; limit?: number } = {}): Promise<LearningRecord[]> {
    const items = await this.table.query<Item & LearningRecord>(PK);
    return items
      .map((item) => record<LearningRecord>(item))
      .filter((entry) => !options.scopes || options.scopes.some((scope) => scope.kind === entry.scope.kind && (scope.kind !== "brand" || scope.brandId === entry.scope.brandId)))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id))
      .slice(0, options.limit ?? LEARNING_LIST_MAX);
  }
}
