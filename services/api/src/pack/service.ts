import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type Batch,
  EXAMPLE_COMMENTS_MAX,
  type FunnelStage,
  type MetaVariant,
  PACK_PICTURE_TYPES,
  type Pack,
  type PackAd,
  type PackExample,
  type PackFormat,
  type PackPictureType,
  type PackSummary,
  type PackUpload,
  type PackVersion,
  type PackView,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILES,
  UPLOAD_TYPES,
  type UploadType,
} from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { BoardService } from "../board/service.js";
import type { BrandStore } from "../brand/store.js";
import type { CopyStore } from "../copy/store.js";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import { metaFaults } from "../meta/checks.js";
import { adName } from "../meta/names.js";
import type { MetaStore } from "../meta/store.js";
import { MAX_PICTURE_BYTES, type Pictures, pictureType } from "../pictures/store.js";
import type { ResultStore } from "../results/store.js";
import type { UploadService } from "../results/uploads.js";
import { type CommentStore, exampleComment, onCurrentAds } from "./comments.js";
import { CARRIED, type PackStore } from "./store.js";

/** How long a picture link of a pack page works. The page asks again when it is opened again. */
const PICTURE_SECONDS = 3600;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  facts: FactStore;
  board: BoardService;
  copy: CopyStore;
  meta: MetaStore;
  packs: PackStore;
  results: ResultStore;
  comments: CommentStore;
  uploads: UploadService;
  pictures: Pictures;
  publicOrigin: string;
  now: () => Date;
}

const CARRY_ID = /^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AD_NAME = /^[A-Za-z0-9_]{1,80}$/;
/** The most pictures one carry takes: three ads, each with the picture the page shows and two download copies. */
export const CARRY_MAX_PICTURES = 9;
const carriedKey = (carryId: string, picture: number) => `carried/${carryId}/${picture}`;
const isPackPicture = (type: string): type is PackPictureType => Object.hasOwn(PACK_PICTURE_TYPES, type);
/** The formats an ad's download gives. A final of a batch is one picture, in the format its key ends with. */
const downloadsOf = (ad: PackAd): { key: string; type: PackPictureType }[] => ad.downloads ?? [{ key: ad.key, type: ad.key.endsWith(".png") ? "image/png" : "image/jpeg" }];
const formatsOf = (ad: PackAd): PackFormat[] => [...new Set(downloadsOf(ad).map((file) => PACK_PICTURE_TYPES[file.type]))];
const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** One ad made outside the studio, as the owner's agent hands it in. A picture is the number `pack_carry_start` gave it. */
export interface CarriedAd {
  adName: string;
  stage?: FunnelStage;
  picture: number;
  /** The pictures a download gives, when they are not the picture the page shows. */
  downloads?: number[];
  words?: { headline: string; subline: string; footnote?: string };
  variants: [MetaVariant, MetaVariant];
  why: string;
  claims: { claim: string; quote: string; url: string }[];
}

export interface CarryInput {
  carryId: string;
  brandId: string;
  product: string;
  ads: CarriedAd[];
  launchPlan: string[];
  example?: PackExample;
}

export interface PackContent {
  /** One line for each ad. An ad with no line keeps the line of the version before. */
  why?: { ideaId: string; why: string }[];
  /** One step in each line. Without it, the plan of the version before stays. */
  launchPlan?: string[];
}

/** The client pack: one private link, and every version of what it shows. Its ads are the finals of a batch, or ads carried in from outside. */
export class PackService {
  constructor(private readonly deps: Deps) {}

  private link(token: string): string {
    return `${this.deps.publicOrigin}/c/${token}`;
  }

  /** The ads of a done batch as a pack carries them now. It refuses when anything a client must get is missing. */
  private async content(batch: Batch, input: PackContent, before: PackVersion | undefined, version: number, versions: PackVersion[] = []): Promise<Omit<PackVersion, "at" | "by">> {
    const { batches, brands, facts, board, copy, meta } = this.deps;
    if (batch.test) throw new Refusal("This is a test batch. A test batch is never done, and nothing of it goes to a client.");
    if (batch.purpose === "outreach") throw new Refusal("This is an outreach batch. Its one ad goes to the owner's outreach page (outreach_attach); it makes no client pack.");
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
      // The name stands for the creative: the same picture with the same text keeps the name it got first, in any version, so its results stay with it.
      const delivered = final.delivered;
      const named = versions.flatMap((entry) => entry.ads).find((ad) => ad.ideaId === idea.id && ad.imageId === delivered.id && ad.meta.version === text.version);
      ads.push({
        ideaId: idea.id,
        adName: named ? named.adName : adName({ at: this.deps.now(), brand: brand.name, batchNumber, ...(idea.stage ? { stage: idea.stage } : {}), idea: index + 1, version }),
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
    // A pack with no version is a publish that stopped halfway: this call finishes it, under a new link.
    const begun = await packs.get(batch.id);
    if (begun && (await packs.versions(batch.id)).length > 0) throw new Refusal("This batch has a pack. Put a newer version into the same link with pack_update: a link is never replaced to change its ads.");
    const version: PackVersion = { ...(await this.content(batch, input, undefined, 1)), at: now().toISOString(), by };
    const token = randomBytes(32).toString("base64url");
    if (begun) await packs.relink(begun, hashToken(token));
    else if (!(await packs.create({ id: batch.id, source: "batch", batchId: batch.id, brandId: batch.brandId, tokenHash: hashToken(token), current: 1, createdAt: version.at, by }))) throw new Refusal("This batch has a pack. Put a newer version into the same link with pack_update.");
    if (!(await packs.addVersion(batch.id, version))) throw new Refusal("Another publish of this pack was saved at the same moment. Read it with pack_get.");
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
    const version: PackVersion = { ...(await this.content(batch, input, before, number, versions)), at: now().toISOString(), by };
    if (!(await packs.addVersion(batch.id, version))) throw new Refusal("Another change to this pack was saved at the same moment. Read it with pack_get and send the change again.");
    await packs.save({ ...pack, current: number });
    return version;
  }

  /** A pack's comments, each under the name its ad has in the version shown. */
  async onCurrentAds<T extends { adName?: string }>(pack: Pack, version: PackVersion, comments: T[]): Promise<T[]> {
    if (comments.every((comment) => comment.adName === undefined || version.ads.some((ad) => ad.adName === comment.adName))) return comments;
    return onCurrentAds(comments, await this.deps.packs.versions(pack.id), version);
  }

  /** Makes the link show an earlier version again. Nothing is deleted. */
  async restore(id: string, version: number): Promise<Pack> {
    const { packs } = this.deps;
    const pack = await packs.get(id);
    if (!pack) throw new Refusal("There is no pack with this id.");
    if (!(await packs.versions(id)).some((entry) => entry.version === version)) throw new Refusal(`This pack has no version ${version}. Read its versions with pack_get.`);
    const next = { ...pack, current: version };
    await packs.save(next);
    return next;
  }

  /** Gives the pack a new link. The old link opens nothing from now on. */
  async relink(id: string): Promise<{ link: string }> {
    const { packs } = this.deps;
    const pack = await packs.get(id);
    if (!pack) throw new Refusal("There is no pack with this id.");
    const token = randomBytes(32).toString("base64url");
    await packs.relink(pack, hashToken(token));
    return { link: this.link(token) };
  }

  /**
   * The first step of carrying in ads made outside the studio: one address for each picture, good for a few minutes and for exactly that type and size.
   * Nothing is saved here. `carry` saves the pack once the pictures are there.
   */
  async carryStart(files: { type: string; bytes: number }[]): Promise<{ carryId: string; uploads: { picture: number; putUrl: string }[] }> {
    const { pictures } = this.deps;
    if (files.length < 1 || files.length > CARRY_MAX_PICTURES) throw new Refusal(`A carried pack has 1 to ${CARRY_MAX_PICTURES} pictures.`);
    for (const file of files) {
      if (!isPackPicture(file.type)) throw new Refusal("A carried picture is a JPEG or a PNG.");
      if (!Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_PICTURE_BYTES) throw new Refusal("A carried picture can be up to 8 MB.");
    }
    const carryId = `${CARRIED}${randomUUID()}`;
    return { carryId, uploads: await Promise.all(files.map(async (file, picture) => ({ picture, putUrl: await pictures.putUrl(carriedKey(carryId, picture), file.type, file.bytes) }))) };
  }

  /**
   * Saves ads made outside the studio as a pack of a brand, with its own link. The link is returned here once.
   * The studio reads each uploaded file itself and keeps only a PNG or a JPEG. A carried pack teaches the studio nothing: it has no batch, no pick and no check.
   */
  async carry(by: string, input: CarryInput): Promise<{ link: string; packId: string; version: PackVersion }> {
    const { packs, brands, pictures, now } = this.deps;
    if (!CARRY_ID.test(input.carryId)) throw new Refusal("This is not the id of a carry. Start one with pack_carry_start.");
    const brand = await brands.brand(input.brandId);
    if (input.ads.length < 1 || input.ads.length > 3) throw new Refusal("A carried pack has one to three ads.");
    if (input.launchPlan.length < 1) throw new Refusal("Give the launch plan, one step in each line.");
    if (new Set(input.ads.map((ad) => ad.adName)).size !== input.ads.length) throw new Refusal("Two ads of this pack have the same name. Results are matched by the name, so each ad needs its own.");
    for (const ad of input.ads) {
      if (!AD_NAME.test(ad.adName)) throw new Refusal(`"${ad.adName.slice(0, 80)}" is not an ad name: letters, digits and "_" only, 80 at most.`);
      if (!ad.why.trim()) throw new Refusal(`Give one line of why for ${ad.adName}.`);
      if (ad.variants.length !== 2 || ad.variants.some((variant) => !variant.primary.trim() || !variant.headline.trim())) throw new Refusal(`${ad.adName} needs two variants of Meta text, each with its primary text and headline.`);
      const unsafe = ad.claims.find((claim) => !isHttps(claim.url));
      if (unsafe) throw new Refusal(`The source of a claim of ${ad.adName} is not an https address.`);
    }
    if (input.example) {
      const { note, comments } = input.example;
      if (!note.trim()) throw new Refusal("An example needs its note: the line that says the brand shown is not a client.");
      if (comments.length > EXAMPLE_COMMENTS_MAX) throw new Refusal(`An example shows ${EXAMPLE_COMMENTS_MAX} example comments at most.`);
    }

    // Each picture is read once, and told by its first bytes: what the sender called it does not count.
    const read = new Map<number, { key: string; type: PackPictureType }>();
    const picture = async (number: number) => {
      const known = read.get(number);
      if (known) return known;
      if (!Number.isInteger(number) || number < 0 || number >= CARRY_MAX_PICTURES) throw new Refusal(`There is no picture ${number} in this carry.`);
      const key = carriedKey(input.carryId, number);
      const body = await pictures.read(key, MAX_PICTURE_BYTES);
      if (!body) throw new Refusal(`Picture ${number} is not there, or it is over 8 MB. Send it to the address pack_carry_start gave, then call this again.`);
      const kind = pictureType(body);
      if (!kind || !isPackPicture(kind.type)) throw new Refusal(`Picture ${number} is not a JPEG or a PNG.`);
      const found = { key, type: kind.type };
      read.set(number, found);
      return found;
    };
    const ads: PackAd[] = [];
    for (const [index, ad] of input.ads.entries()) {
      const shown = await picture(ad.picture);
      const downloads = ad.downloads ? await Promise.all(ad.downloads.map(picture)) : undefined;
      if (downloads && (downloads.length < 1 || new Set(downloads.map((file) => file.type)).size !== downloads.length)) throw new Refusal(`The downloads of ${ad.adName} are one picture of each format at most: a JPEG, a PNG, or both.`);
      ads.push({
        ideaId: `carried-${index + 1}`,
        adName: ad.adName,
        ...(ad.stage ? { stage: ad.stage } : {}),
        imageId: `carried-${ad.picture}`,
        key: shown.key,
        ...(ad.words ? { words: ad.words } : {}),
        meta: { version: 1, variants: ad.variants },
        why: ad.why,
        claims: ad.claims,
        // A carried picture's address has no ending, so the type the studio read is kept with it.
        downloads: downloads ?? [shown],
      });
    }

    const begun = await packs.get(input.carryId);
    if (begun && (await packs.versions(begun.id)).length > 0) throw new Refusal("This carry is saved already. Read its pack with pack_get.");
    const version: PackVersion = { version: 1, ads, launchPlan: input.launchPlan, at: now().toISOString(), by };
    const token = randomBytes(32).toString("base64url");
    const pack: Pack = { id: input.carryId, source: "carried", brandId: brand.id, product: input.product, ...(input.example ? { example: { note: input.example.note.trim(), comments: input.example.comments.map((comment) => exampleComment(comment, input.ads.map((ad) => ad.adName))) } } : {}), tokenHash: hashToken(token), current: 1, createdAt: version.at, by };
    if (begun) await packs.relink(begun, pack.tokenHash);
    else if (!(await packs.create(pack))) throw new Refusal("This carry is saved already. Read its pack with pack_get.");
    if (!(await packs.addVersion(pack.id, version))) throw new Refusal("Another save of this carry happened at the same moment. Read its pack with pack_get.");
    return { link: this.link(token), packId: pack.id, version };
  }

  /** The brand and the product a pack is for: from its batch, or from the pack itself when it was carried in. */
  private async names(pack: Pick<Pack, "source" | "batchId" | "brandId" | "product">): Promise<{ brand: { id: string; name: string }; product: { id?: string; name: string } }> {
    const { batches, brands } = this.deps;
    if (pack.source === "carried") {
      const brand = await brands.brand(pack.brandId as string);
      return { brand: { id: brand.id, name: brand.name }, product: { name: pack.product ?? "" } };
    }
    const batch = await batches.get(pack.batchId as string);
    const [brand, product] = await Promise.all([brands.brand(batch.brandId), brands.product(batch.productId)]);
    return { brand: { id: brand.id, name: brand.name }, product: { id: product.id, name: product.name } };
  }

  /** The pack a token opens and the version it shows, or nothing. */
  async opened(token: string): Promise<{ pack: Pack; version: PackVersion } | undefined> {
    const { packs } = this.deps;
    if (!TOKEN.test(token)) return undefined;
    const pack = await packs.byHash(hashToken(token));
    const version = pack && (await packs.versions(pack.id)).find((entry) => entry.version === pack.current);
    return pack && version ? { pack, version } : undefined;
  }

  /** What a link shows, or nothing when no pack has this token. */
  async view(token: string): Promise<PackView | undefined> {
    const found = await this.opened(token);
    return found && this.viewOf(found.pack, found.version);
  }

  /** The version a pack shows now, or nothing for a pack that was never finished. */
  async current(pack: Pack): Promise<PackVersion | undefined> {
    return (await this.deps.packs.versions(pack.id)).find((entry) => entry.version === pack.current);
  }

  /** The brand a pack belongs to. */
  async brandOf(pack: Pack): Promise<string> {
    return pack.brandId ?? (await this.deps.batches.get(pack.batchId as string)).brandId;
  }

  /** A pack as a page shows it: no key of a picture and no id of the studio. */
  async viewOf(pack: Pack, version: PackVersion): Promise<PackView> {
    const { pictures } = this.deps;
    const { brand, product } = await this.names(pack);
    return {
      brand: brand.name,
      product: product.name,
      version: version.version,
      at: version.at,
      ads: await Promise.all(
        version.ads.map(async (ad) => {
          const { key, imageId: _imageId, ideaId: _ideaId, downloads: _downloads, ...shown } = ad;
          return { ...shown, viewUrl: await pictures.viewUrl(key, PICTURE_SECONDS), formats: formatsOf(ad) };
        }),
      ),
      launchPlan: version.launchPlan,
      ...(pack.example ? { example: pack.example } : { comments: await this.onCurrentAds(pack, version, await this.deps.comments.shown(pack.id)) }),
    };
  }

  /**
   * An address that downloads one ad of the pack a link shows, good for a few minutes, or nothing when the link or the ad is not there.
   * It is made at the click, so a page that stayed open for a day still downloads. The file of an example says so in its name.
   */
  async download(token: string, ad: number, format?: string): Promise<string | undefined> {
    const found = await this.opened(token);
    return found && this.downloadOf(found.pack, found.version, ad, format);
  }

  async downloadOf(pack: Pack, version: PackVersion, ad: number, format?: string): Promise<string | undefined> {
    const chosen = version.ads[ad];
    if (!chosen) return undefined;
    const files = downloadsOf(chosen);
    const file = format === undefined ? files[0] : files.find((entry) => PACK_PICTURE_TYPES[entry.type] === format);
    if (!file) return undefined;
    return this.deps.pictures.downloadUrl(file.key, `${pack.example ? "example_" : ""}${chosen.adName}.${PACK_PICTURE_TYPES[file.type]}`);
  }

  /**
   * Takes the word of a client that a results file is coming, and returns the one link that file can be sent to.
   * Undefined when no pack has this token. The file goes to a folder apart from the studio's pictures.
   */
  async upload(token: string, file: { name: string; type: string; bytes: number }): Promise<{ upload: Pick<PackUpload, "id" | "name">; putUrl: string } | undefined> {
    if (!TOKEN.test(token)) return undefined;
    const pack = await this.deps.packs.byHash(hashToken(token));
    return pack && this.uploadTo(pack, file);
  }

  async uploadTo(pack: Pack, file: { name: string; type: string; bytes: number }): Promise<{ upload: Pick<PackUpload, "id" | "name">; putUrl: string }> {
    const { results, pictures } = this.deps;
    // The link of an example is held by many strangers. It takes nothing, whatever the page that asks looks like.
    if (pack.example) throw new Refusal("This page is an example. It takes no file.");
    if (!Object.hasOwn(UPLOAD_TYPES, file.type)) throw new Refusal("Send a JPEG or PNG screenshot, or a CSV export.");
    if (!Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > UPLOAD_MAX_BYTES) throw new Refusal("A file can be up to 10 MB.");
    const type = file.type as UploadType;
    // The name is shown to the owner: letters, digits and a few marks only, so it cannot carry a path or a script.
    const name = (file.name.split(/[\\/]/).at(-1) ?? "").replace(/[^\p{L}\p{N} ._()-]+/gu, "_").replace(/^\.+/, "").slice(0, 120) || "file";
    const upload = await results.addUpload(pack.id, { name, type, bytes: file.bytes, packVersion: pack.current }, (id) => `quarantine/packs/${pack.id}/${id}.${UPLOAD_TYPES[type]}`);
    if (!upload) throw new Refusal(`This link has taken ${UPLOAD_MAX_FILES} files, which is the most it takes. Send the rest to your contact at the studio.`);
    return { upload: { id: upload.id, name: upload.name }, putUrl: await pictures.putUrl(upload.key, type, file.bytes) };
  }

  /** Every pack as the dashboard lists it, newest first. No link: the studio does not keep it. */
  async summaries(): Promise<PackSummary[]> {
    const { packs, pictures, results, uploads: files } = this.deps;
    const list = await Promise.all(
      (await packs.all()).map(async ({ tokenHash: _tokenHash, ...pack }): Promise<PackSummary> => {
        const [{ brand, product }, versions, uploads, typed] = await Promise.all([this.names(pack), packs.versions(pack.id), files.list(pack.id), results.results(pack.id)]);
        return {
          pack,
          brand,
          product,
          versions: await Promise.all(versions.map(async (version) => ({ ...version, ads: await Promise.all(version.ads.map(async (ad) => ({ ...ad, viewUrl: await pictures.viewUrl(ad.key) }))) }))),
          uploads: await Promise.all(uploads.map(async ({ key, ...upload }) => ({ ...upload, ...(upload.state === "checked" && upload.type !== "text/csv" ? { openUrl: await pictures.viewUrl(key) } : {}) }))),
          results: typed,
        };
      }),
    );
    return list.sort((a, b) => b.pack.createdAt.localeCompare(a.pack.createdAt));
  }
}
