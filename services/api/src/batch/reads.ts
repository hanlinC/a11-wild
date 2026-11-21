import type { BatchKind } from "@a11-wild/shared";
import type { Table } from "../store/table.js";
import { hasWords } from "./state.js";

/** What an agent must read before it writes ideas, with the tool that reads each. */
export const TASTE_READS = { canon: "canon_get", taste_log: "taste_log", swipe: "swipe_search" } as const;
/** The owner's reference ads. An ad with words is held against them, so it needs them read too; for v1 they are loose examples. */
export const REFERENCE_READ = "references_get";
export type TasteRead = keyof typeof TASTE_READS | "references";

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

  /** The tools still to call for this batch. Empty when all were read. */
  async missing(batchId: string, kind: BatchKind): Promise<string[]> {
    const done = new Set((await this.table.query(`BATCH#${batchId}`)).map((item) => item.sk));
    const unread = (Object.keys(TASTE_READS) as (keyof typeof TASTE_READS)[]).filter((what) => !done.has(`READ#${what}`)).map((what): string => TASTE_READS[what]);
    return hasWords(kind) && !done.has("READ#references") ? [...unread, REFERENCE_READ] : unread;
  }
}
