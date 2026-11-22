import type { Batch, BatchImage, Idea, Render, RenderKind } from "@a11-wild/shared";
import { hasWords, requireMove, StateError, stepAfter } from "../batch/state.js";
import type { DirectionStore } from "../direction/store.js";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import { estimateUsd, type FalClient } from "../fal/client.js";
import type { ImageStore } from "../images/store.js";
import { Refusal } from "../mcp/registry.js";
import type { Pictures } from "../pictures/store.js";
import { GateError, type GateStage, type SpendGate } from "../spend/gate.js";
import { log } from "../log.js";
import type { MadeCount } from "../made/count.js";
import { NotBilledError, type SpendLedger } from "../spend/ledger.js";
import { toMicro, toUsd } from "../spend/money.js";
import { RENDER_RULES, wordsAsked } from "./prompt-guard.js";
import { publicRender, type RenderStore, type StoredRender } from "./store.js";

export const DRAFTS_PER_IDEA = 3;
/** A final that fails its checks may be made again, this many times for one idea. */
export const FINALS_PER_IDEA = 3;
export const REFERENCES_MAX = 4;
/** A rough is a cheap look at a concept before the owner picks: few for each concept, few for a batch. */
export const ROUGHS_PER_CONCEPT = 2;
export const ROUGHS_PER_BATCH = 8;

/** The state from which a batch's drafts can be made: its ideas are judged, its words are approved when it has words, and a concept has its direction. */
const draftsFrom = (batch: Batch) => (batch.kind === "v3" ? "directed" : hasWords(batch.kind) ? "worded" : "judged");

/** The real photo that a name stands for: "pack-1" is the product's first pack photo. */
export function photoNamed(product: { photos: { kind: string; key: string }[] }, name: string) {
  const [kind, number] = name.split("-");
  return product.photos.filter((photo) => photo.kind === kind)[Number(number) - 1];
}

/** fal reads a reference picture when the job starts, which can be some minutes after it is sent. */
const REFERENCE_LINK_SECONDS = 3600;

/** What decides whether a draft may become a final. The picks and the checks answer it. */
export interface FinalRule {
  /** Refuses unless the owner picked this draft and it has no D item. Returns how many finals the batch will make, and the picture the final is made from: the draft, or its repair. */
  allow(batch: Batch, ideaId: string, draft: BatchImage): Promise<{ finals: number; source: BatchImage }>;
  /** Why a draft's picture is rejected by its checks, or nothing when it is not. */
  rejection(batchId: string, imageId: string): Promise<string | undefined>;
}

export interface RenderRequest {
  batchId: string;
  ideaId: string;
  kind: RenderKind;
  prompt: string;
  /** A draft's skeleton, or the picked draft of a final. */
  fromId?: string;
  /** A draft of a concept ad: which of the direction's three drafts it is. */
  draft?: number;
  /** Other pictures the model sees: keys of the product's photos or the brand's logo. */
  /** Names of the product's photos and the brand's logo: "logo", "pack-1", "food-2". Never a key. */
  references: string[];
}

export interface RenderView extends Render {
  image?: BatchImage & { viewUrl: string };
  note?: string;
}

interface Deps {
  directions: DirectionStore;
  batches: BatchStore;
  brands: BrandStore;
  images: ImageStore;
  renders: RenderStore;
  ledger: SpendLedger;
  gate: SpendGate;
  fal: FalClient;
  pictures: Pictures;
  finals: FinalRule;
  made: Pick<MadeCount, "one">;
}

const STAGE: Record<RenderKind, GateStage> = { rough: "roughs", draft: "drafts", final: "finals" };
const live = (render: Render) => render.status !== "failed";
/** What the failed renders of one kind were charged all the same, and the places of the stage they hold. A charged rough keeps its place among the roughs of the batch; a draft or a final is sent again. */
function billedOf(all: StoredRender[], kind: RenderKind): { micro: number; places: number } {
  const charged = all.filter((render) => render.kind === kind && render.billed);
  return { micro: charged.reduce((sum, render) => sum + render.reservation.micro, 0), places: kind === "rough" ? charged.length : 0 };
}

/** Turns an idea and a skeleton into drafts and finals, each at a price the owner's gate has passed. */
export class RenderService {
  constructor(private readonly deps: Deps) {}

  async view(render: StoredRender, note?: string): Promise<RenderView> {
    const image = render.imageId ? await this.deps.images.get(render.batchId, render.imageId) : undefined;
    return {
      ...publicRender(render),
      ...(image ? { image: { ...image, viewUrl: await this.deps.pictures.viewUrl(image.key) } } : {}),
      ...(note ? { note } : {}),
    };
  }

  async list(batchId: string): Promise<RenderView[]> {
    await this.deps.batches.get(batchId);
    return Promise.all((await this.deps.renders.list(batchId)).map((render) => this.view(render)));
  }

  /**
   * The owner's rule R26 for one stage. The first render of a stage goes alone and gives the price;
   * the rest wait for that price, and for the owner's yes when the stage comes to US$1 or more.
   */
  private async passGate(batch: Batch, kind: RenderKind, sent: StoredRender[], next: { usedMicro: number; micro: number; billed: { micro: number; places: number } }): Promise<Batch> {
    const { gate, batches } = this.deps;
    const stage = STAGE[kind];
    if (!(await gate.peek(batch.id, stage))) {
      const first = sent.find((render) => render.status === "done");
      if (!first) {
        if (sent.length === 0) return batch;
        throw new GateError(`The first of the ${stage} is out to read the price. Read it with render_status until it is done, then send the rest.`);
      }
      // The price was not saved when the first render ended. Save it now from that render.
      await gate.price(batch.id, stage, { firstUsd: first.usd, count: first.stageCount, billed: next.billed });
    }
    if (kind === "draft" && batch.state === draftsFrom(batch)) batch = await batches.move(batch, "priced", "render_submit");
    try {
      await gate.check(batch.id, stage, { sent: sent.length + next.billed.places, usedMicro: next.usedMicro, micro: next.micro });
    } catch (error) {
      if (error instanceof GateError && batch.state === "priced") await batches.move(batch, "waiting_spend", "render_submit");
      throw error;
    }
    return batch;
  }

  async submit(input: RenderRequest): Promise<RenderView> {
    const { batches, brands, images, renders, ledger, fal, pictures, finals } = this.deps;
    let batch = await batches.get(input.batchId);
    if (batch.format !== "static_4x5") throw new Refusal("This batch ends with a text spec: the studio renders a static 4:5 picture only.");
    const asked = wordsAsked(input.prompt);
    if (asked) {
      throw new Refusal(`R16: a picture carries the brand logo and no words. This prompt asks for words in the picture ("${asked}"). Describe the scene only. The studio adds the no-words rule itself, and the logo is the one mark.`);
    }
    if (input.kind === "rough" && batch.kind !== "v3") throw new Refusal("Only a batch of concept ads (v3) has roughs. A v1 or v2 batch starts with its drafts.");
    // A rough is made of any concept of the set. A draft or a final is made of an idea the batch chose.
    const idea: Idea | undefined = (input.kind === "rough" ? await batches.burst(batch.id) : await batches.ideas(batch.id)).find((saved) => saved.id === input.ideaId);
    if (!idea) throw new Refusal(`This batch has no ${input.kind === "rough" ? "concept" : "idea"} ${input.ideaId}. batch_get gives ${input.kind === "rough" ? "its concepts in burst" : "its ideas"}.`);
    await fal.ready();
    const realPhotos = () => {
      // Real photos first: the model builds from a real photo of each thing the picture shows, never from its own guess.
      const missing = (idea.shows ?? []).filter((name) => !photoNamed(product, name));
      if (missing.length > 0) {
        throw new Refusal(`Real photos first: idea ${idea.id} shows ${missing.join(", ")}, and this product has no such photo. Find a real photo of each one (image_search or the brand's own pages) and save it with product_save. The model never invents a product, a food or a prop.`);
      }
    };

    const [product, brand, all] = await Promise.all([brands.product(batch.productId), brands.brand(batch.brandId), renders.list(batch.id)]);
    const sent = all.filter((render) => render.kind === input.kind && live(render));
    const redone = new Set(sent.map((render) => render.redoOf));
    // A draft that was made again does not count: its redo stands in its place.
    let mine = sent.filter((render) => render.ideaId === idea.id && !redone.has(render.id));
    let from: BatchImage | undefined;
    /** The picture the model sees in place of `from`: a picked draft's repair. */
    let source: BatchImage | undefined;
    let count: number;
    /** A draft of a concept ad starts from its rough: the picture the critic and the owner judged the concept by. */
    let rough: BatchImage | undefined;
    let directionVersion: number | undefined;
    let redoOf: string | undefined;

    if (input.kind === "rough") {
      if (!["ideas", "reviewed"].includes(batch.state)) requireMove(batch, "ideas", "render_submit");
      if (input.fromId) throw new Refusal("A rough has no skeleton: the model draws it from the product's real photos. Give them in references.");
      realPhotos();
      // The model draws from what it is given: a real photo that is saved and not sent does nothing.
      const unsent = (idea.shows ?? []).filter((name) => !input.references.includes(name));
      if (unsent.length > 0) {
        throw new Refusal(`Real photos first: concept ${idea.id} shows ${unsent.join(", ")}. Give the real photo of each one in references, so that the model draws from it and not from its own guess.`);
      }
      count = ROUGHS_PER_BATCH;
    } else if (input.kind === "draft") {
      if (![draftsFrom(batch), "priced", "waiting_spend", "drafting"].includes(batch.state)) {
        // An ad with words waits for the owner's yes to them: no draft is paid for before it.
        if (batch.state === "judged" || (batch.kind === "v3" && batch.state === "worded")) throw new StateError(`render_submit cannot run yet: the batch is at "${batch.state}". The step that is missing: ${stepAfter(batch)}.`);
        requireMove(batch, "drafting", "render_submit");
      }
      realPhotos();
      if (batch.kind === "v3") {
        const direction = await this.deps.directions.get(batch.id);
        const plan = direction?.concepts.find((concept) => concept.ideaId === idea.id);
        if (!direction || !plan) throw new Refusal(`Concept ${idea.id} has no direction. Save it first (direction_save): a draft answers one of its three questions.`);
        // A concept whose direction was lowered starts again: the drafts of its earlier direction do not count.
        mine = mine.filter((render) => (render.directionVersion ?? 0) >= (plan.since ?? 0));
        const asked = plan.drafts.find((draft) => draft.number === input.draft);
        if (!asked) throw new Refusal(`Say which draft of the direction this is: draft ${plan.drafts.map((draft) => draft.number).join(", ")} of ${idea.id} (direction_get gives each one's question and axes).`);
        const before = mine.find((render) => render.draft === asked.number);
        if (before) {
          const already = `Draft ${asked.number} of ${idea.id} ("${asked.question}") is already sent.`;
          if (before.status !== "done") throw new Refusal(`${already} Read it with render_status.`);
          if (before.redoOf) {
            throw new Refusal(`${already} It has had its one redo. With fewer than two drafts of ${idea.id} that pass their checks, save a new direction with a lower risk (direction_save).`);
          }
          const fault = await finals.rejection(batch.id, before.id);
          if (!fault) throw new Refusal(`${already} A draft is made again once, and only when its checks reject it (a D item, or two F items).`);
          redoOf = before.id;
        }
        directionVersion = direction.version;
        rough = (await images.list(batch.id, "rough")).filter((image) => image.ideaId === idea.id).at(-1);
        // Real photos first: the model sees the real photo of each thing the concept shows, round a skeleton or not.
        const unsent = (idea.shows ?? []).filter((name) => !input.references.includes(name));
        if (unsent.length > 0) throw new Refusal(`Real photos first: concept ${idea.id} shows ${unsent.join(", ")}. Give the real photo of each one in references.`);
        if (!rough && !input.fromId) {
          throw new Refusal(`Concept ${idea.id} has no rough, so its draft starts from a plan of the real photos. Build one (skeleton_make, with the real photo of each thing it shows) and give its id as fromId.`);
        }
      } else if (input.draft !== undefined) {
        throw new Refusal("Only a draft of a concept ad (v3) has a number from its direction.");
      }
      if (mine.length - (redoOf ? 1 : 0) >= DRAFTS_PER_IDEA) throw new Refusal(`Idea ${idea.id} has its ${DRAFTS_PER_IDEA} drafts. A draft that failed can be sent again; one that is done cannot.`);
      const hasPack = product.photos.some((photo) => photo.kind === "pack");
      if (input.fromId) {
        from = await images.get(batch.id, input.fromId);
        if (from.kind !== "skeleton") throw new Refusal(`Picture ${from.id} is a ${from.kind}, not a skeleton. A draft is built round a skeleton (skeleton_make).`);
        // A draft made again keeps its question, so it may keep its skeleton: only another draft of the idea needs its own.
        if (mine.some((render) => render.id !== redoOf && render.fromId === from?.id)) {
          throw new Refusal("R23: each draft of an idea comes from its own skeleton. This skeleton already has a draft of this idea. Make another skeleton, with another camera, crop or scale.");
        }
      } else if (hasPack && batch.kind !== "v3") {
        // A concept ad draws the product from its real photos by default, so that it can be held, turned or opened. pack_check then measures its shape.
        throw new Refusal("R29: this product has a pack photo, so each draft is built round a skeleton that holds the real pack. Make one with skeleton_make and give its id as fromId.");
      }
      count = (await batches.ideas(batch.id)).length * DRAFTS_PER_IDEA;
    } else {
      if (!["waiting_pick", "finals"].includes(batch.state)) requireMove(batch, "finals", "render_submit");
      if (!input.fromId) throw new Refusal("A final is made from the draft the owner picked. Give that draft's picture id as fromId.");
      from = await images.get(batch.id, input.fromId);
      if (from.kind !== "draft" || from.ideaId !== idea.id) throw new Refusal(`Picture ${from.id} is not a draft of idea ${idea.id}.`);
      const allowed = await finals.allow(batch, idea.id, from);
      count = allowed.finals;
      source = allowed.source;
      if (mine.length >= FINALS_PER_IDEA) throw new Refusal(`Idea ${idea.id} has had ${FINALS_PER_IDEA} finals. Tell the owner before more are made.`);
    }

    const pack = input.references.find((name) => name.startsWith("pack-"));
    const named = input.references.map((name) => {
      const [kind, number] = name.split("-");
      const picture = kind === "logo" ? brand.logo : photoNamed(product, name);
      if (!picture) throw new Refusal(`This ${kind === "logo" ? "brand has no logo" : `product has no ${kind} photo ${number}`}. A reference picture is the brand's logo ("logo") or one of this product's photos ("pack-1", "food-1", "prop-1").`);
      return picture.key;
    });
    const keys = [...new Set([...(from ? [(source ?? from).key] : []), ...(rough ? [rough.key] : []), ...named])];
    // The picture a render is built round and the rough of a concept go to the model on top of the real photos, so that neither takes the place of one.
    if (new Set(named).size > REFERENCES_MAX) throw new Refusal(`A render takes ${REFERENCES_MAX} reference pictures or fewer.`);

    if (input.kind === "rough") {
      const full = await renders.claimRough(batch.id, idea.id, { concept: ROUGHS_PER_CONCEPT, batch: ROUGHS_PER_BATCH });
      if (full === "concept") throw new Refusal(`Concept ${idea.id} has its ${ROUGHS_PER_CONCEPT} roughs. A rough is a first look, not a draft: show what there is.`);
      if (full === "batch") throw new Refusal(`This batch has its ${ROUGHS_PER_BATCH} roughs. A rough is a first look: the critic and the owner judge the concepts from what there is.`);
    }
    const usd = estimateUsd(input.kind, keys.length);
    let reservation;
    let job;
    try {
      // What the stage came to so far: every render that stands, and every failed one that fal charged for.
      const billed = billedOf(all, input.kind);
      const usedMicro = billed.micro + sent.reduce((sum, render) => sum + render.reservation.micro, 0);
      batch = await this.passGate(batch, input.kind, sent, { usedMicro, micro: toMicro(usd), billed });
      reservation = await ledger.reserve({ service: "fal", kind: input.kind, ref: `${idea.id}: ${idea.title}`, batchId: batch.id, usd });
    } catch (error) {
      if (input.kind === "rough") await renders.releaseRough(batch.id, idea.id);
      throw error;
    }
    try {
      const referenceUrls = await Promise.all(keys.map((key) => pictures.viewUrl(key, REFERENCE_LINK_SECONDS)));
      job = await fal.submit({ kind: input.kind, prompt: `${input.prompt.trim()}\n\n${RENDER_RULES}`, referenceUrls });
    } catch (error) {
      // Only a sure refusal gives the money back. Any other failure may still be billed, and a rough that may be billed keeps its place.
      if (error instanceof NotBilledError) {
        await ledger.release(reservation);
        if (input.kind === "rough") await renders.releaseRough(batch.id, idea.id);
      }
      throw error;
    }
    const render = await renders.create({
      batchId: batch.id,
      ideaId: idea.id,
      kind: input.kind,
      prompt: input.prompt.trim(),
      ...(from ? { fromId: from.id } : {}),
      ...(directionVersion !== undefined && input.draft !== undefined ? { draft: input.draft, directionVersion } : {}),
      ...(redoOf ? { redoOf } : {}),
      ...(pack ? { pack } : {}),
      usd,
      fal: job,
      reservation,
      stageCount: count,
    });
    if (input.kind === "draft" && (batch.state === "priced" || batch.state === "waiting_spend")) await batches.move(batch, "drafting", "render_submit");
    if (input.kind === "final" && batch.state === "waiting_pick") await batches.move(batch, "finals", "render_submit");
    // The critic has not seen this rough: its review of the concepts is no longer the whole of them.
    if (input.kind === "rough" && batch.state === "reviewed") await batches.move(batch, "ideas", "render_submit");
    const alone = sent.length === 0 ? `This is the first of the ${STAGE[input.kind]}: it goes alone to read the price. Read it with render_status until it is done, then send the rest.` : undefined;
    return this.view(render, alone);
  }

  /** Reads a render. When fal is done, the picture is copied into the private store once and the ledger is settled once. */
  async status(batchId: string, renderId: string): Promise<RenderView> {
    const { renders, images, pictures, ledger, gate, batches, fal, made } = this.deps;
    const render = await renders.get(batchId, renderId);
    if (render.status !== "queued") return this.view(render);
    const result = await fal.poll(render.fal);
    if (result.state === "queued") return this.view(render, result.note ?? "fal is still making it; read again in a few seconds.");

    if (result.state === "failed") {
      // Only a sure refusal gives the money back. A picture that fal made and the studio could not copy was still billed.
      if (await renders.end(render, { status: "failed", error: result.error, ...(result.refund ? {} : { billed: true as const }) })) {
        await (result.refund ? ledger.release(render.reservation) : ledger.settle(render.reservation));
        // A rough that was not billed gives its place back.
        if (render.kind === "rough" && result.refund) await renders.releaseRough(batchId, render.ideaId);
      }
      return this.view(await renders.get(batchId, renderId));
    }

    // The picture has the render's id, so a second read writes the same picture and adds no other.
    const key = `batches/${batchId}/${render.kind}s/${render.id}.${result.ext}`;
    await pictures.put(key, result.body, result.type);
    await images.add({ id: render.id, batchId, kind: render.kind, key, ideaId: render.ideaId, ...(render.fromId ? { fromId: render.fromId } : {}) });
    if (await renders.end(render, { status: "done", imageId: render.id })) {
      await ledger.settle(render.reservation);
      // The count is a number for the owner to read: a write of it that fails does not fail the render.
      await made.one().catch((error: unknown) => log.error("made_count_failed", { error: error instanceof Error ? error.name : "unknown" }));
      const stage = STAGE[render.kind];
      if (!(await gate.peek(batchId, stage))) {
        const batch = await batches.get(batchId);
        const state = await gate.price(batchId, stage, { firstUsd: toUsd(render.reservation.micro), count: render.stageCount, billed: billedOf(await renders.list(batchId), render.kind) });
        if (render.kind === "draft" && batch.state === draftsFrom(batch)) await batches.move(batch, "priced", "render_status");
        const done = await renders.get(batchId, renderId);
        return this.view(
          done,
          state.needsYes
            ? `The ${state.count} ${stage} come to about US$${state.estimateUsd.toFixed(2)}, which is US$1 or more. Show the owner the count and the estimate and wait for his yes (spend_approve) before the rest are sent.`
            : `The ${state.count} ${stage} come to about US$${state.estimateUsd.toFixed(2)}, under US$1: send the rest.`,
        );
      }
    }
    return this.view(await renders.get(batchId, renderId));
  }
}
