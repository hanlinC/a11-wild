import type { Table } from "../store/table.js";

/** What an agent must read before it writes ideas, with the tool that reads each. */
export const TASTE_READS = { canon: "canon_get", taste_log: "taste_log", swipe: "swipe_search" } as const;
export type TasteRead = keyof typeof TASTE_READS;

/** Records, on a batch, that the owner's taste was read for it. */
export class BatchReads {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async mark(batchId: string | undefined, what: TasteRead): Promise<void> {
    if (!batchId) return;
    await this.table.put({ pk: `BATCH#${batchId}`, sk: `READ#${what}`, at: this.now().toISOString() });
  }

  /** The tools still to call for this batch. Empty when all three were read. */
  async missing(batchId: string): Promise<string[]> {
    const done = new Set((await this.table.query(`BATCH#${batchId}`)).map((item) => item.sk));
    return (Object.keys(TASTE_READS) as TasteRead[]).filter((what) => !done.has(`READ#${what}`)).map((what) => TASTE_READS[what]);
  }
}
