import { randomUUID } from "node:crypto";
import type { Batch, BatchState, Idea } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";
import { requireMove } from "./state.js";

const PK = "BATCH";

/** A batch saved before the studio had kinds is a v1 batch. */
const stored = (item: Item & Batch): Batch => ({ ...record<Batch>(item), kind: item.kind ?? "v1" });

/** A batch and its saved steps. Each step is written as it is done, so a stopped session resumes from the batch id alone. */
export class BatchStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async create(input: Pick<Batch, "kind" | "brandId" | "productId" | "format" | "createdBy"> & { formatNote?: string; label?: string }): Promise<Batch> {
    const at = this.now().toISOString();
    const batch: Batch = { ...input, id: randomUUID(), state: "intake", createdAt: at, updatedAt: at };
    await this.table.put({ pk: PK, sk: batch.id, ...batch });
    return batch;
  }

  async get(batchId: string): Promise<Batch> {
    const item = await this.table.get<Item & Batch>(PK, batchId);
    if (!item) throw new Refusal(`There is no batch ${batchId}. batch_list gives the batches.`);
    return stored(item);
  }

  /** Newest first. */
  async list(): Promise<Batch[]> {
    const items = await this.table.query<Item & Batch>(PK);
    return items.map(stored).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Moves a batch to a state the diagram allows from where it is. A save of the same step again keeps the state. */
  async move(batch: Batch, to: BatchState, tool: string, fields: Partial<Pick<Batch, "spec" | "truthVersion">> = {}): Promise<Batch> {
    if (batch.state !== to) requireMove(batch, to, tool);
    const moved: Batch = { ...batch, ...fields, state: to, updatedAt: this.now().toISOString() };
    await this.table.put({ pk: PK, sk: moved.id, ...moved });
    return moved;
  }

  async saveIdeas(batchId: string, ideas: Idea[], by: string): Promise<void> {
    await this.table.put({ pk: `${PK}#${batchId}`, sk: "IDEAS", ideas, savedAt: this.now().toISOString(), savedBy: by });
  }

  /** Every idea written for a batch whose critic chooses from many. Its chosen ideas are `ideas`. */
  async saveBurst(batchId: string, ideas: Idea[], by: string): Promise<void> {
    await this.table.put({ pk: `${PK}#${batchId}`, sk: "BURST", ideas, savedAt: this.now().toISOString(), savedBy: by });
  }

  async burst(batchId: string): Promise<Idea[]> {
    const item = await this.table.get<Item & { ideas: Idea[] }>(`${PK}#${batchId}`, "BURST");
    return item?.ideas ?? [];
  }

  async ideas(batchId: string): Promise<Idea[]> {
    const item = await this.table.get<Item & { ideas: Idea[] }>(`${PK}#${batchId}`, "IDEAS");
    return item?.ideas ?? [];
  }
}
