import type { Measure, Product, TruthSheet } from "@a11-wild/shared";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const PK = "TRUTH";

export interface TruthInput {
  shape: string;
  packaging: string;
  measures: { name: string; value: number; unit: string; factId?: string }[];
  food?: { photoKeys: string[]; proportions: string };
}

/** A product's truth sheet. A number is sourced only by a saved fact of the same product; any other number is unverified. */
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
    const sheet: TruthSheet = {
      productId: product.id,
      shape: input.shape,
      packaging: input.packaging,
      measures,
      ...(input.food ? { food: input.food } : {}),
      savedAt: this.now().toISOString(),
      savedBy: by,
    };
    await this.table.put({ pk: PK, sk: product.id, ...sheet });
    return sheet;
  }

  async get(productId: string): Promise<TruthSheet | undefined> {
    const item = await this.table.get<Item & TruthSheet>(PK, productId);
    return item ? record<TruthSheet>(item) : undefined;
  }
}
