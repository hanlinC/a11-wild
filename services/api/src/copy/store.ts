import type { ApprovedCopy } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (ideaId: string) => `COPY#${ideaId}`;

/** The words the owner approved for each idea of a batch. A picture gets its words from here and from nowhere else. */
export class CopyStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async get(batchId: string, ideaId: string): Promise<ApprovedCopy | undefined> {
    const item = await this.table.get<Item & ApprovedCopy>(pk(batchId), sk(ideaId));
    return item && record<ApprovedCopy>(item);
  }

  async list(batchId: string): Promise<ApprovedCopy[]> {
    const items = await this.table.query<Item & ApprovedCopy>(pk(batchId));
    return items.filter((item) => item.sk.startsWith("COPY#")).map((item) => record<ApprovedCopy>(item));
  }

  /** Saves the owner's approval. The same words again keep their version; other words add one. */
  async approve(batchId: string, words: Omit<ApprovedCopy, "version" | "at">): Promise<ApprovedCopy> {
    const before = await this.get(batchId, words.ideaId);
    const same = before && before.headline === words.headline && before.subline === words.subline && before.footnote === words.footnote;
    // The same words keep their time too: a picture that carries them still carries the approved words.
    const saved: ApprovedCopy = { ...words, version: before ? before.version + (same ? 0 : 1) : 1, at: before && same ? before.at : this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: sk(words.ideaId), ...saved });
    return saved;
  }
}
