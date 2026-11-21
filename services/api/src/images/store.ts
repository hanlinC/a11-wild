import { randomUUID } from "node:crypto";
import type { BatchImage, ImageKind } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (imageId: string) => `IMAGE#${imageId}`;

/** The pictures of a batch: which picture is what, and what it was made from. The bytes are in the picture store. */
export class ImageStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Saving the same id again changes nothing, so a step that runs twice makes one picture. */
  async add(input: Omit<BatchImage, "id" | "createdAt"> & { id?: string }): Promise<BatchImage> {
    const image: BatchImage = { ...input, id: input.id ?? randomUUID(), createdAt: this.now().toISOString() };
    if (await this.table.put({ pk: pk(image.batchId), sk: sk(image.id), ...image }, { ifNotExists: true })) return image;
    return this.get(image.batchId, image.id);
  }

  async get(batchId: string, imageId: string): Promise<BatchImage> {
    const item = await this.table.get<Item & BatchImage>(pk(batchId), sk(imageId));
    if (!item) throw new Refusal(`This batch has no picture ${imageId}. render_list gives its pictures.`);
    return record<BatchImage>(item);
  }

  /** Oldest first. */
  async list(batchId: string, kind?: ImageKind): Promise<BatchImage[]> {
    const items = await this.table.query<Item & BatchImage>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("IMAGE#") && (!kind || item.kind === kind))
      .map((item) => record<BatchImage>(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
}
