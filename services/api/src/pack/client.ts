import { createHash, randomBytes } from "node:crypto";
import type { ClientLink, ClientView, Pack, PackVersion } from "@a11-wild/shared";
import type { BrandStore } from "../brand/store.js";
import { Refusal } from "../mcp/registry.js";
import { hashToken, type PackService, TOKEN } from "./service.js";
import type { PackStore } from "./store.js";

/** The name of a pack on a client's page. It stands for the pack there and gives away no id of the studio. */
export const packRef = (id: string): string => createHash("sha256").update(`pack-ref:${id}`).digest("hex").slice(0, 24);
const REF = /^[0-9a-f]{24}$/;

interface Deps {
  brands: BrandStore;
  packs: PackStore;
  pack: PackService;
  publicOrigin: string;
  now: () => Date;
}

/**
 * The client's link: one private address that opens every pack of one brand.
 * It is a link of the same kind as a pack's: a random token, of which the studio keeps only the hash.
 */
export class ClientService {
  constructor(private readonly deps: Deps) {}

  private async issue(brandId: string, by: string): Promise<{ link: string }> {
    const { packs, publicOrigin, now } = this.deps;
    const token = randomBytes(32).toString("base64url");
    await packs.setClientLink({ brandId, state: "on", at: now().toISOString(), by }, hashToken(token));
    return { link: `${publicOrigin}/client/${token}` };
  }

  /** Makes the brand's client link. The link is returned here once. */
  async make(brandId: string, by: string): Promise<{ link: string }> {
    const brand = await this.deps.brands.brand(brandId);
    if ((await this.deps.packs.clientLink(brand.id))?.state === "on") throw new Refusal("This brand has a client link. The studio does not keep it: replace it to get a new one, and the old one opens nothing from then on.");
    return this.issue(brand.id, by);
  }

  /** Gives the brand a new client link. The old one opens nothing from now on. */
  async replace(brandId: string, by: string): Promise<{ link: string }> {
    const brand = await this.deps.brands.brand(brandId);
    if ((await this.deps.packs.clientLink(brand.id))?.state !== "on") throw new Refusal("This brand has no client link that is on. Make one first.");
    return this.issue(brand.id, by);
  }

  /** Turns the brand's client link off. It opens nothing until a new one is made. */
  async turnOff(brandId: string, by: string): Promise<ClientLink> {
    const { packs, now } = this.deps;
    const link: ClientLink = { brandId, state: "off", at: now().toISOString(), by };
    if (!(await packs.endClientLink(link))) throw new Refusal("This brand has no client link that is on.");
    return link;
  }

  /** The packs a brand's client sees, newest first: finished packs of that brand, and never an example. */
  async packsOf(brandId: string): Promise<{ pack: Pack; version: PackVersion }[]> {
    const { packs, pack: service } = this.deps;
    const found = await Promise.all(
      (await packs.all()).map(async (pack) => {
        if (pack.example || (await service.brandOf(pack)) !== brandId) return undefined;
        const version = await service.current(pack);
        return version ? { pack, version } : undefined;
      }),
    );
    return found.filter((entry) => entry !== undefined).sort((a, b) => b.pack.createdAt.localeCompare(a.pack.createdAt));
  }

  private async brandOf(token: string): Promise<string | undefined> {
    return TOKEN.test(token) ? this.deps.packs.brandByHash(hashToken(token)) : undefined;
  }

  /** What a client's link shows, or nothing when no client link has this token. */
  async view(token: string): Promise<ClientView | undefined> {
    const brandId = await this.brandOf(token);
    if (!brandId) return undefined;
    const [brand, shown] = await Promise.all([this.deps.brands.brand(brandId), this.packsOf(brandId)]);
    return { brand: brand.name, packs: await Promise.all(shown.map(async ({ pack, version }) => ({ ref: packRef(pack.id), ...(await this.deps.pack.viewOf(pack, version)) }))) };
  }

  /** One pack of the page a client's link opens, or nothing. A link reaches the packs of its own brand only. */
  async find(token: string, ref: string): Promise<{ pack: Pack; version: PackVersion } | undefined> {
    if (!REF.test(ref)) return undefined;
    const brandId = await this.brandOf(token);
    return brandId ? (await this.packsOf(brandId)).find(({ pack }) => packRef(pack.id) === ref) : undefined;
  }
}
