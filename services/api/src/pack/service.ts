import { createHash, randomBytes } from "node:crypto";
import type { Batch, Pack, PackAd, PackSummary, PackVersion, PackView } from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { BoardService } from "../board/service.js";
import type { BrandStore } from "../brand/store.js";
import type { CopyStore } from "../copy/store.js";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import { metaFaults } from "../meta/checks.js";
import { adName } from "../meta/names.js";
import type { MetaStore } from "../meta/store.js";
import type { Pictures } from "../pictures/store.js";
import type { PackStore } from "./store.js";

/** How long a picture link of a pack page works. The page asks again when it is opened again. */
const PICTURE_SECONDS = 3600;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  facts: FactStore;
  board: BoardService;
  copy: CopyStore;
  meta: MetaStore;
  packs: PackStore;
  pictures: Pictures;
  publicOrigin: string;
  now: () => Date;
}

export interface PackContent {
  /** One line for each ad. An ad with no line keeps the line of the version before. */
  why?: { ideaId: string; why: string }[];
  /** One step in each line. Without it, the plan of the version before stays. */
  launchPlan?: string[];
}

/** The client pack of a batch: one private link, and every version of what it shows. */
export class PackService {
  constructor(private readonly deps: Deps) {}

  private link(token: string): string {
    return `${this.deps.publicOrigin}/c/${token}`;
  }

  /** The ads of a done batch as a pack carries them now. It refuses when anything a client must get is missing. */
  private async content(batch: Batch, input: PackContent, before: PackVersion | undefined, version: number): Promise<Omit<PackVersion, "at" | "by">> {
    const { batches, brands, facts, board, copy, meta } = this.deps;
    if (batch.test) throw new Refusal("This is a test batch. A test batch is never done, and nothing of it goes to a client.");
    if (batch.state !== "done") throw new Refusal(`This batch is "${batch.state}". A pack holds the finals of a done batch: run batch_done first.`);
    const [finals, ideas, words, brand, product, all] = await Promise.all([board.finals(batch), batches.ideas(batch.id), copy.list(batch.id), brands.brand(batch.brandId), brands.product(batch.productId), batches.list()]);
    const known = await facts.list(product.id);
    const batchNumber = all.filter((other) => other.brandId === batch.brandId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).findIndex((other) => other.id === batch.id) + 1;

    const ads: PackAd[] = [];
    for (const [index, idea] of ideas.entries()) {
      const final = finals.find((entry) => entry.ideaId === idea.id);
      if (!final?.pick?.imageId) continue;
      // A final that fails a check is not delivered, even in a batch that was done before the check was saved.
      if (!final.delivered) throw new Refusal(`The final of ${idea.id} is not ready for a client: ${final.missing.join("; ")}.`);
      const text = await meta.approved(batch.id, idea.id);
      if (!text) throw new Refusal(`The owner has not approved the Meta text of ${idea.id}. Save it with meta_save, show it to him, and save his yes with meta_approve.`);
      const picture = words.find((entry) => entry.ideaId === idea.id);
      const { truth } = metaFaults(text.variants, { ...(picture ? { picture } : {}), ...(idea.stage ? { stage: idea.stage } : {}), facts: known });
      if (truth.length > 0) throw new Refusal(`The approved Meta text of ${idea.id} no longer holds: ${truth.join("; ")}. Save text that holds and ask the owner again.`);
      const earlier = before?.ads.find((ad) => ad.ideaId === idea.id);
      const why = input.why?.find((entry) => entry.ideaId === idea.id)?.why ?? earlier?.why;
      if (!why) throw new Refusal(`Give one line of why for ${idea.id}: the buyer truth, what the ad does, and the source.`);
      // The name stands for the creative: the same picture with the same text keeps its name, so its results stay with it.
      const same = earlier && earlier.imageId === final.delivered.id && earlier.meta.version === text.version;
      ads.push({
        ideaId: idea.id,
        adName: same ? earlier.adName : adName({ at: this.deps.now(), brand: brand.name, batchNumber, ...(idea.stage ? { stage: idea.stage } : {}), idea: index + 1, version }),
        ...(idea.stage ? { stage: idea.stage } : {}),
        imageId: final.delivered.id,
        key: final.delivered.key,
        ...(picture ? { words: { headline: picture.headline, subline: picture.subline, ...(picture.footnote ? { footnote: picture.footnote } : {}) } } : {}),
        meta: { version: text.version, variants: text.variants },
        why,
        claims: (idea.claims ?? []).flatMap((claim) => {
          const fact = known.find((entry) => entry.id === claim.factId);
          return fact ? [{ claim: fact.claim, quote: fact.quote, url: fact.url }] : [];
        }),
      });
    }
    if (ads.length === 0) throw new Refusal("This batch has no picked ad, so there is nothing to put in a pack.");
    const launchPlan = input.launchPlan ?? before?.launchPlan;
    if (!launchPlan) throw new Refusal("Give the launch plan, one step in each line: one ad set, all the ads, 72 hours, and when to stop an ad.");
    return { version, ads, launchPlan };
  }

  /** Makes the pack of a batch and its link. The link is returned here once: only the hash of its token is kept. */
  async publish(batch: Batch, by: string, input: PackContent): Promise<{ link: string; version: PackVersion }> {
    const { packs, now } = this.deps;
    if (await packs.get(batch.id)) throw new Refusal("This batch has a pack. Put a newer version into the same link with pack_update: a link is never replaced to change its ads.");
    const version: PackVersion = { ...(await this.content(batch, input, undefined, 1)), at: now().toISOString(), by };
    const token = randomBytes(32).toString("base64url");
    const pack: Pack = { batchId: batch.id, tokenHash: hashToken(token), current: 1, createdAt: version.at, by };
    if (!(await packs.create(pack))) throw new Refusal("This batch has a pack. Put a newer version into the same link with pack_update.");
    await packs.addVersion(batch.id, version);
    return { link: this.link(token), version };
  }

  /** Puts the batch's ads as they are now into the same link, as a new version. The versions before it are kept. */
  async update(batch: Batch, by: string, input: PackContent): Promise<PackVersion> {
    const { packs, now } = this.deps;
    const pack = await packs.get(batch.id);
    if (!pack) throw new Refusal("This batch has no pack yet. Make it with pack_publish.");
    const versions = await packs.versions(batch.id);
    const before = versions.find((entry) => entry.version === pack.current);
    const number = (versions.at(-1)?.version ?? 0) + 1;
    const version: PackVersion = { ...(await this.content(batch, input, before, number)), at: now().toISOString(), by };
    if (!(await packs.addVersion(batch.id, version))) throw new Refusal("Another change to this pack was saved at the same moment. Read it with pack_get and send the change again.");
    await packs.save({ ...pack, current: number });
    return version;
  }

  /** Makes the link show an earlier version again. Nothing is deleted. */
  async restore(batch: Batch, version: number): Promise<Pack> {
    const { packs } = this.deps;
    const pack = await packs.get(batch.id);
    if (!pack) throw new Refusal("This batch has no pack.");
    if (!(await packs.versions(batch.id)).some((entry) => entry.version === version)) throw new Refusal(`This pack has no version ${version}. Read its versions with pack_get.`);
    const next = { ...pack, current: version };
    await packs.save(next);
    return next;
  }

  /** Gives the pack a new link. The old link opens nothing from now on. */
  async relink(batch: Batch): Promise<{ link: string }> {
    const { packs } = this.deps;
    const pack = await packs.get(batch.id);
    if (!pack) throw new Refusal("This batch has no pack.");
    const token = randomBytes(32).toString("base64url");
    await packs.relink(pack, hashToken(token));
    return { link: this.link(token) };
  }

  /** What a link shows, or nothing when no pack has this token. */
  async view(token: string): Promise<PackView | undefined> {
    const { packs, batches, brands, pictures } = this.deps;
    if (!TOKEN.test(token)) return undefined;
    const pack = await packs.byHash(hashToken(token));
    const version = pack && (await packs.versions(pack.batchId)).find((entry) => entry.version === pack.current);
    if (!pack || !version) return undefined;
    const batch = await batches.get(pack.batchId);
    const [brand, product] = await Promise.all([brands.brand(batch.brandId), brands.product(batch.productId)]);
    return {
      brand: brand.name,
      product: product.name,
      version: version.version,
      at: version.at,
      ads: await Promise.all(version.ads.map(async ({ key, imageId: _imageId, ideaId: _ideaId, ...ad }) => ({ ...ad, viewUrl: await pictures.viewUrl(key, PICTURE_SECONDS) }))),
      launchPlan: version.launchPlan,
    };
  }

  /** Every pack as the dashboard lists it, newest first. No link: the studio does not keep it. */
  async summaries(): Promise<PackSummary[]> {
    const { packs, batches, brands, pictures } = this.deps;
    const list = await Promise.all(
      (await packs.all()).map(async ({ tokenHash: _tokenHash, ...pack }): Promise<PackSummary> => {
        const batch = await batches.get(pack.batchId);
        const [brand, product, versions] = await Promise.all([brands.brand(batch.brandId), brands.product(batch.productId), packs.versions(pack.batchId)]);
        return {
          pack,
          brand: { id: brand.id, name: brand.name },
          product: { id: product.id, name: product.name },
          versions: await Promise.all(versions.map(async (version) => ({ ...version, ads: await Promise.all(version.ads.map(async (ad) => ({ ...ad, viewUrl: await pictures.viewUrl(ad.key) }))) }))),
        };
      }),
    );
    return list.sort((a, b) => b.pack.createdAt.localeCompare(a.pack.createdAt));
  }
}
