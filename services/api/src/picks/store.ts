import type { Pick } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (ideaId: string) => `PICK#${ideaId}`;

/** The owner's choice for each idea of a batch. A new choice for an idea replaces the earlier one; the taste log keeps both. */
export class PickStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async save(batchId: string, input: Omit<Pick, "at">): Promise<Pick> {
    const pick: Pick = { ...input, at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: sk(pick.ideaId), ...pick });
    return pick;
  }

  async all(batchId: string): Promise<Pick[]> {
    const items = await this.table.query<Item & Pick>(pk(batchId));
    return items.filter((item) => item.sk.startsWith("PICK#")).map((item) => record<Pick>(item));
  }
}
