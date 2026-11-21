import { randomUUID } from "node:crypto";
import type { BrandNote } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (brandId: string) => `BRANDNOTES#${brandId}`;
export const BRAND_NOTES_READ = 50;

/** What the owner chose for one brand, in his words. Rows are only added, and only a batch of that brand reads them. */
export class BrandNotes {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async add(input: Omit<BrandNote, "id" | "at">): Promise<BrandNote> {
    const at = this.now().toISOString();
    const note: BrandNote = { ...input, id: randomUUID().slice(0, 8), at };
    await this.table.put({ pk: pk(input.brandId), sk: `N#${at}#${note.id}`, ...note });
    return note;
  }

  /** Newest first. */
  async list(brandId: string): Promise<BrandNote[]> {
    const items = await this.table.query<Item & BrandNote>(pk(brandId));
    return items
      .map((item) => record<BrandNote>(item))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, BRAND_NOTES_READ);
  }
}
