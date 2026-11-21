import type { Pack, PackVersion } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const LINKS = "PACKLINK";
const pk = (batchId: string) => `BATCH#${batchId}`;
const PACK = "PACK";
const sk = (version: number) => `PACKV#${String(version).padStart(4, "0")}`;

/** The pack of each batch, every version of its content, and the way from a link's token hash to its pack. */
export class PackStore {
  constructor(private readonly table: Table) {}

  async get(batchId: string): Promise<Pack | undefined> {
    const item = await this.table.get<Item & Pack>(pk(batchId), PACK);
    return item && record<Pack>(item);
  }

  /** The pack behind a token hash, or nothing. A hash that was replaced opens nothing. */
  async byHash(tokenHash: string): Promise<Pack | undefined> {
    const link = await this.table.get<Item & { batchId: string }>(LINKS, tokenHash);
    const pack = link && (await this.get(link.batchId));
    return pack && pack.tokenHash === tokenHash ? pack : undefined;
  }

  async all(): Promise<Pack[]> {
    const links = await this.table.query<Item & { batchId: string }>(LINKS);
    const packs = await Promise.all(links.map((link) => this.byHash(link.sk)));
    return packs.filter((pack): pack is Pack => pack !== undefined);
  }

  /** Makes the pack of a batch. False when the batch already has one. */
  async create(pack: Pack): Promise<boolean> {
    if (!(await this.table.put({ pk: pk(pack.batchId), sk: PACK, ...pack }, { ifNotExists: true }))) return false;
    await this.table.put({ pk: LINKS, sk: pack.tokenHash, batchId: pack.batchId });
    return true;
  }

  async save(pack: Pack): Promise<void> {
    await this.table.put({ pk: pk(pack.batchId), sk: PACK, ...pack });
  }

  /** Gives the pack another token hash. The old one opens nothing from now on. */
  async relink(pack: Pack, tokenHash: string): Promise<Pack> {
    const next = { ...pack, tokenHash };
    await this.table.put({ pk: LINKS, sk: tokenHash, batchId: pack.batchId });
    await this.save(next);
    await this.table.delete(LINKS, pack.tokenHash);
    return next;
  }

  async versions(batchId: string): Promise<PackVersion[]> {
    const items = await this.table.query<Item & PackVersion>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("PACKV#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .map((item) => record<PackVersion>(item));
  }

  /** Saves a new version. False when that version number is taken. */
  async addVersion(batchId: string, version: PackVersion): Promise<boolean> {
    return this.table.put({ pk: pk(batchId), sk: sk(version.version), ...version }, { ifNotExists: true });
  }
}
