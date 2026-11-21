import type { Brief } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const SK = "BRIEF";

/** The brief of a batch of concept ads: what buyers think and do, and how sure each of those is. */
export class BriefStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async get(batchId: string): Promise<Brief | undefined> {
    const item = await this.table.get<Item & Brief>(pk(batchId), SK);
    return item && record<Brief>(item);
  }

  async save(batchId: string, brief: Omit<Brief, "version" | "at">): Promise<Brief> {
    const before = await this.get(batchId);
    const saved: Brief = { ...brief, version: (before?.version ?? 0) + 1, at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: SK, ...saved });
    return saved;
  }
}
