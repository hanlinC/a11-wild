import type { Made } from "@a11-wild/shared";
import type { Table } from "../store/table.js";

const PK = "STATS";
const SK = "made";

/**
 * The pictures the image models returned before the studio kept its own count: 1,075 on Replicate's
 * invoices and 505 in fal's activity, read on 23-11-2026 (docs/decisions.md). It holds the work of the
 * earlier tools on the same two accounts, and this studio's own up to that day.
 */
export const MADE_BEFORE = 1580;

/** The count of the pictures a model returned. It goes up by one when a render ends with its picture, and at no other time. */
export class MadeCount {
  constructor(
    private readonly table: Table,
    private readonly references: { count(): Promise<number> },
  ) {}

  async one(): Promise<void> {
    await this.table.add(PK, SK, "images", 1);
  }

  async read(): Promise<Made> {
    const [counted, chosen] = await Promise.all([this.table.get<{ pk: string; sk: string; images?: number }>(PK, SK), this.references.count()]);
    return { images: MADE_BEFORE + (counted?.images ?? 0), chosen };
  }
}
