import type { Item, Table } from "../../src/store/table.js";

/** The table contract, held in a Map. */
export class MemoryTable implements Table {
  private readonly items = new Map<string, Item>();

  private key(pk: string, sk: string): string {
    return `${pk}\u0000${sk}`;
  }

  async get<T extends Item>(pk: string, sk: string): Promise<T | undefined> {
    const item = this.items.get(this.key(pk, sk));
    return item ? (structuredClone(item) as T) : undefined;
  }

  async put(item: Item, options: { ifNotExists?: boolean } = {}): Promise<boolean> {
    const key = this.key(item.pk, item.sk);
    if (options.ifNotExists && this.items.has(key)) return false;
    this.items.set(key, structuredClone(item));
    return true;
  }

  async delete(pk: string, sk: string, options: { ifEquals?: { attribute: string; value: string } } = {}): Promise<boolean> {
    const { ifEquals } = options;
    if (ifEquals && this.items.get(this.key(pk, sk))?.[ifEquals.attribute] !== ifEquals.value) return false;
    this.items.delete(this.key(pk, sk));
    return true;
  }

  async query<T extends Item>(pk: string): Promise<T[]> {
    return [...this.items.values()].filter((item) => item.pk === pk).map((item) => structuredClone(item) as T);
  }
}
