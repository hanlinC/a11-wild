import type { MetaText, MetaVariant } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const prefix = (ideaId: string) => `META#${ideaId}#`;
const sk = (ideaId: string, version: number) => `${prefix(ideaId)}${String(version).padStart(4, "0")}`;

const same = (a: MetaVariant[], b: MetaVariant[]) => JSON.stringify(a.map(fields)) === JSON.stringify(b.map(fields));
const fields = ({ primary, headline, description, cta }: MetaVariant) => [primary, headline, description, cta];

/** The Meta text of each ad of a batch, every version of it. A pack reads its text from here: no one types it again. */
export class MetaStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Every version of every ad's text, oldest first for each idea. */
  async all(batchId: string): Promise<MetaText[]> {
    const items = await this.table.query<Item & MetaText>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("META#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .map((item) => record<MetaText>(item));
  }

  async versions(batchId: string, ideaId: string): Promise<MetaText[]> {
    return (await this.all(batchId)).filter((text) => text.ideaId === ideaId);
  }

  /** The text a pack carries: the newest version the owner said yes to. */
  async approved(batchId: string, ideaId: string): Promise<MetaText | undefined> {
    return (await this.versions(batchId, ideaId)).filter((text) => text.approved).at(-1);
  }

  /** Saves text as a new version. The same text as the newest version is that version. */
  async save(batchId: string, text: Pick<MetaText, "ideaId" | "variants" | "by">): Promise<MetaText> {
    // Two saves at one moment both get a version: the second finds the number taken and takes the next.
    for (;;) {
      const newest = (await this.versions(batchId, text.ideaId)).at(-1);
      if (newest && same(newest.variants, text.variants)) return newest;
      const saved: MetaText = { ...text, version: (newest?.version ?? 0) + 1, at: this.now().toISOString() };
      if (await this.table.put({ pk: pk(batchId), sk: sk(text.ideaId, saved.version), ...saved }, { ifNotExists: true })) return saved;
    }
  }

  /** Saves the owner's yes to one version. Undefined when there is no such version. */
  async approve(batchId: string, input: { ideaId: string; version: number; ownerSaid: string; by: string }): Promise<MetaText | undefined> {
    const item = await this.table.get<Item & MetaText>(pk(batchId), sk(input.ideaId, input.version));
    if (!item) return undefined;
    const saved: MetaText = { ...record<MetaText>(item), approved: { ownerSaid: input.ownerSaid, at: this.now().toISOString(), by: input.by } };
    await this.table.put({ pk: pk(batchId), sk: sk(input.ideaId, input.version), ...saved });
    return saved;
  }
}
