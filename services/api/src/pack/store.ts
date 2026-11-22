import type { ClientLink, Pack, PackVersion } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const LINKS = "PACKLINK";
/** The start of a carried pack's id. A batch's id is a UUID, so it never starts with it. */
export const CARRIED = "c_";
/** Where a pack and all that hangs on it is kept: with its batch, or in a place of its own for a carried pack. */
export const packKey = (id: string) => (id.startsWith(CARRIED) ? `CPACK#${id}` : `BATCH#${id}`);
const pk = packKey;
const PACK = "PACK";
type Stored = Item & Omit<Pack, "id" | "source"> & Partial<Pick<Pack, "id" | "source">>;
/** A pack saved before packs had a source is the pack of its batch. */
const read = (item: Stored): Pack => {
  const { id, source, ...rest } = record<Omit<Stored, keyof Item>>(item as never) as Omit<Pack, "id" | "source"> & Partial<Pick<Pack, "id" | "source">>;
  return { ...rest, id: id ?? (rest.batchId as string), source: source ?? "batch" };
};
type Link = Item & { packId?: string; batchId?: string; brandId?: string };
const CLIENTS = "CLIENTLINK";
type StoredClient = ClientLink & { tokenHash?: string };
const sk = (version: number) => `PACKV#${String(version).padStart(4, "0")}`;

/** Each pack, every version of its content, and the way from a link's token hash to its pack. */
export class PackStore {
  constructor(private readonly table: Table) {}

  async get(id: string): Promise<Pack | undefined> {
    const item = await this.table.get<Stored>(pk(id), PACK);
    return item && read(item);
  }

  /** The pack behind a token hash, or nothing. A hash that was replaced opens nothing. */
  async byHash(tokenHash: string): Promise<Pack | undefined> {
    const link = await this.table.get<Link>(LINKS, tokenHash);
    const id = link?.packId ?? link?.batchId;
    const pack = id ? await this.get(id) : undefined;
    return pack && pack.tokenHash === tokenHash ? pack : undefined;
  }

  async all(): Promise<Pack[]> {
    const links = await this.table.query<Link>(LINKS);
    const packs = await Promise.all(links.map((link) => this.byHash(link.sk)));
    return packs.filter((pack): pack is Pack => pack !== undefined);
  }

  /** Makes a pack. False when a pack with this id is already there. */
  async create(pack: Pack): Promise<boolean> {
    if (!(await this.table.put({ pk: pk(pack.id), sk: PACK, ...pack }, { ifNotExists: true }))) return false;
    await this.table.put({ pk: LINKS, sk: pack.tokenHash, packId: pack.id });
    return true;
  }

  async save(pack: Pack): Promise<void> {
    await this.table.put({ pk: pk(pack.id), sk: PACK, ...pack });
  }

  /** Gives the pack another token hash. The old one opens nothing from now on. */
  async relink(pack: Pack, tokenHash: string): Promise<Pack> {
    const next = { ...pack, tokenHash };
    await this.table.put({ pk: LINKS, sk: tokenHash, packId: pack.id });
    await this.save(next);
    await this.table.delete(LINKS, pack.tokenHash);
    return next;
  }

  /** The brand a client's link opens, or nothing. A pack's token opens no client page: its link names a pack, not a brand. */
  async brandByHash(tokenHash: string): Promise<string | undefined> {
    const link = await this.table.get<Link>(LINKS, tokenHash);
    if (!link?.brandId) return undefined;
    const client = await this.table.get<Item & StoredClient>(CLIENTS, link.brandId);
    return client?.state === "on" && client.tokenHash === tokenHash ? link.brandId : undefined;
  }

  async clientLink(brandId: string): Promise<ClientLink | undefined> {
    const item = await this.table.get<Item & StoredClient>(CLIENTS, brandId);
    if (!item) return undefined;
    const { tokenHash: _tokenHash, ...shown } = record<StoredClient>(item);
    return shown;
  }

  async clientLinks(): Promise<ClientLink[]> {
    return (await this.table.query<Item & StoredClient>(CLIENTS)).map((item) => {
      const { tokenHash: _tokenHash, ...shown } = record<StoredClient>(item);
      return shown;
    });
  }

  /** Gives the brand's client link this token hash. A hash it had before opens nothing from now on. */
  async setClientLink(link: ClientLink, tokenHash: string): Promise<void> {
    const before = await this.table.get<Item & StoredClient>(CLIENTS, link.brandId);
    await this.table.put({ pk: LINKS, sk: tokenHash, brandId: link.brandId });
    await this.table.put({ pk: CLIENTS, sk: link.brandId, ...link, tokenHash });
    if (before?.tokenHash && before.tokenHash !== tokenHash) await this.table.delete(LINKS, before.tokenHash);
  }

  /** Turns the brand's client link off. False when the brand has no link that is on. */
  async endClientLink(link: ClientLink): Promise<boolean> {
    const before = await this.table.get<Item & StoredClient>(CLIENTS, link.brandId);
    if (before?.state !== "on") return false;
    // The record goes first: from that write on, the old hash opens nothing even while its link row is still there.
    await this.table.put({ pk: CLIENTS, sk: link.brandId, ...link });
    if (before.tokenHash) await this.table.delete(LINKS, before.tokenHash);
    return true;
  }

  async versions(id: string): Promise<PackVersion[]> {
    const items = await this.table.query<Item & PackVersion>(pk(id));
    return items
      .filter((item) => item.sk.startsWith("PACKV#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .map((item) => record<PackVersion>(item));
  }

  /** Saves a new version. False when that version number is taken. */
  async addVersion(id: string, version: PackVersion): Promise<boolean> {
    return this.table.put({ pk: pk(id), sk: sk(version.version), ...version }, { ifNotExists: true });
  }
}
