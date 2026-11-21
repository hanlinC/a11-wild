import type { Measure, Product, TruthSheet } from "@a11-wild/shared";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const pk = (productId: string) => `TRUTH#${productId}`;
const versionKey = (version: number) => `V#${String(version).padStart(6, "0")}`;

/** The same text for the same content, in whatever order the store returns the fields. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, part: unknown) =>
    part && typeof part === "object" && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part,
  );

export interface TruthInput {
  shape: string;
  packaging: string;
  measures: { name: string; value: number; unit: string; factId?: string }[];
  food?: { photoKeys: string[]; proportions: string };
}

/**
 * A product's truth sheet. A number is sourced only by a saved fact of the same product; any other
 * number is unverified. A product has one sheet, shared by its batches. Every save that changes it
 * makes a new version, and no version is ever changed or removed, so a batch can keep the version
 * its ideas were written from.
 */
export class TruthStore {
  constructor(
    private readonly table: Table,
    private readonly facts: FactStore,
    private readonly now: () => Date,
  ) {}

  async save(product: Product, input: TruthInput, by: string): Promise<TruthSheet> {
    const known = new Map((await this.facts.list(product.id)).map((fact) => [fact.id, fact]));
    const measures: Measure[] = input.measures.map(({ name, value, unit, factId }) => {
      if (!factId) return { name, value, unit, status: "unverified" };
      const fact = known.get(factId);
      if (!fact) throw new Refusal(`"${name}" names fact ${factId}, which is not a saved fact of this product. Save the fact with facts_save, or leave factId out and the number is kept as unverified.`);
      return { name, value, unit, status: "sourced", source: { factId, quote: fact.quote, url: fact.url } };
    });
    const foodKeys = new Set(product.photos.filter((photo) => photo.kind === "food").map((photo) => photo.key));
    const stray = input.food?.photoKeys.find((key) => !foodKeys.has(key));
    if (stray) throw new Refusal(`${stray} is not a food photo of this product. Use the keys of its photos with kind "food".`);
    const body = {
      productId: product.id,
      shape: input.shape,
      packaging: input.packaging,
      measures,
      ...(input.food ? { food: input.food } : {}),
    };
    const latest = await this.get(product.id);
    if (latest) {
      const { version: _version, savedAt: _savedAt, savedBy: _savedBy, ...kept } = latest;
      // A save that changes nothing makes no new version.
      if (stable(kept) === stable(body)) return latest;
    }
    // Two saves at the same moment each take their own number: a version is written only where none is yet.
    let version = (latest?.version ?? 0) + 1;
    const sheet = (): TruthSheet => ({ ...body, version, savedAt: this.now().toISOString(), savedBy: by });
    while (!(await this.table.put({ pk: pk(product.id), sk: versionKey(version), ...sheet() }, { ifNotExists: true }))) version += 1;
    return sheet();
  }

  /** The newest version of a product's sheet, or the version asked for. */
  async get(productId: string, version?: number): Promise<TruthSheet | undefined> {
    if (version !== undefined) {
      const item = await this.table.get<Item & TruthSheet>(pk(productId), versionKey(version));
      return item ? record<TruthSheet>(item) : undefined;
    }
    const items = await this.table.query<Item & TruthSheet>(pk(productId));
    const newest = items.sort((a, b) => b.version - a.version)[0];
    return newest ? record<TruthSheet>(newest) : undefined;
  }

  /** Every version of a product's sheet, newest first, with who saved it and when. */
  async versions(productId: string): Promise<Pick<TruthSheet, "version" | "savedAt" | "savedBy">[]> {
    const items = await this.table.query<Item & TruthSheet>(pk(productId));
    return items.map(({ version, savedAt, savedBy }) => ({ version, savedAt, savedBy })).sort((a, b) => b.version - a.version);
  }
}
