import { randomUUID } from "node:crypto";
import type { BrandKit, Product } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const DAY_SECONDS = 24 * 60 * 60;
const BRANDS = "BRAND";
const brandKey = (brandId: string) => `BRAND#${brandId}`;

/**
 * What an extract or a picture search offered. Kept for a day, so that a save can prove the
 * owner chose among things the studio itself found, and nothing else gets in.
 */
export interface Offer {
  id: string;
  kind: "brand" | "product" | "images";
  /** The page the offer was read from. */
  url: string;
  logos: string[];
  photos: string[];
  productPages: string[];
  colours: string[];
}

export class BrandStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async offer(offer: Omit<Offer, "id">): Promise<Offer> {
    const saved: Offer = { ...offer, id: randomUUID() };
    await this.table.put({ pk: "OFFER", sk: saved.id, ...saved, expiresAt: Math.floor(this.now().getTime() / 1000) + DAY_SECONDS });
    return saved;
  }

  async offered(id: string): Promise<Offer> {
    const item = await this.table.get<Item & Offer & { expiresAt: number }>("OFFER", id);
    if (!item || item.expiresAt * 1000 < this.now().getTime()) {
      throw new Refusal(`There is no extract ${id}, or it is more than a day old. Run the extract again.`);
    }
    return record<Offer>(item);
  }

  async saveBrand(kit: Omit<BrandKit, "id" | "createdAt"> & { id?: string }): Promise<BrandKit> {
    const saved: BrandKit = { ...kit, id: kit.id ?? randomUUID(), createdAt: this.now().toISOString() };
    await this.table.put({ pk: BRANDS, sk: saved.id, ...saved });
    return saved;
  }

  async brand(brandId: string): Promise<BrandKit> {
    const item = await this.table.get<Item & BrandKit>(BRANDS, brandId);
    if (!item) throw new Refusal(`There is no brand ${brandId}. Call brand_list for the saved brands.`);
    return record<BrandKit>(item);
  }

  async brands(): Promise<BrandKit[]> {
    const items = await this.table.query<Item & BrandKit>(BRANDS);
    return items.map((item) => record<BrandKit>(item)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveProduct(product: Omit<Product, "id" | "createdAt"> & { id?: string }): Promise<Product> {
    await this.brand(product.brandId);
    const saved: Product = { ...product, id: product.id ?? randomUUID(), createdAt: this.now().toISOString() };
    await this.table.put({ pk: brandKey(saved.brandId), sk: `PRODUCT#${saved.id}`, ...saved });
    // A second item finds the product by its id alone.
    await this.table.put({ pk: "PRODUCT", sk: saved.id, brandId: saved.brandId });
    return saved;
  }

  async product(productId: string): Promise<Product> {
    const pointer = await this.table.get<Item & { brandId: string }>("PRODUCT", productId);
    const item = pointer && (await this.table.get<Item & Product>(brandKey(pointer.brandId), `PRODUCT#${productId}`));
    if (!item) throw new Refusal(`There is no product ${productId}. Call brand_list for the saved products.`);
    return record<Product>(item);
  }

  async products(brandId: string): Promise<Product[]> {
    const items = await this.table.query<Item & Product>(brandKey(brandId));
    return items
      .filter((item) => item.sk.startsWith("PRODUCT#"))
      .map((item) => record<Product>(item))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
