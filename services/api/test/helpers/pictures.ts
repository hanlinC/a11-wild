import type { Pictures } from "../../src/pictures/store.js";

export class MemoryPictures implements Pictures {
  readonly files = new Map<string, { body: Uint8Array; type: string }>();

  async put(key: string, body: Uint8Array, type: string): Promise<void> {
    this.files.set(key, { body, type });
  }

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.files.get(key)?.body;
  }

  async viewUrl(key: string): Promise<string> {
    return `https://pictures.example/${key}?signed=1`;
  }
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
