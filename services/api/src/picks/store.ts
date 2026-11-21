import type { Pick } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (ideaId: string) => `PICK#${ideaId}`;

/** The owner's choice for each idea of a batch. A new choice for an idea replaces the earlier one and keeps his first; the taste log keeps them all. */
export class PickStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async save(batchId: string, input: Omit<Pick, "at" | "first">): Promise<Pick> {
    const earlier = await this.table.get<Item & Pick>(pk(batchId), sk(input.ideaId));
    const first = earlier && (earlier.first ?? { imageId: earlier.imageId, ...(earlier.shownId ? { shownId: earlier.shownId } : {}), at: earlier.at });
    const pick: Pick = { ...input, at: this.now().toISOString(), ...(first ? { first } : {}) };
    await this.table.put({ pk: pk(batchId), sk: sk(pick.ideaId), ...pick });
    return pick;
  }

  async all(batchId: string): Promise<Pick[]> {
    const items = await this.table.query<Item & Pick>(pk(batchId));
    return items.filter((item) => item.sk.startsWith("PICK#")).map((item) => record<Pick>(item));
  }
}
