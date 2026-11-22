import type { Pictures } from "../../src/pictures/store.js";

export class MemoryPictures implements Pictures {
  readonly files = new Map<string, { body: Uint8Array; type: string }>();

  async put(key: string, body: Uint8Array, type: string): Promise<void> {
    this.files.set(key, { body, type });
  }

  async read(key: string, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array | undefined> {
    const body = this.files.get(key)?.body;
    return body && body.length <= maxBytes ? body : undefined;
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }

  async viewUrl(key: string): Promise<string> {
    return `https://pictures.example/${key}?signed=1`;
  }

  async putUrl(key: string, type: string, bytes: number): Promise<string> {
    return `https://pictures.example/${key}?put=1&type=${encodeURIComponent(type)}&bytes=${bytes}`;
  }

  async downloadUrl(key: string, name: string): Promise<string> {
    return `https://pictures.example/${key}?download=${encodeURIComponent(name)}`;
  }
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
