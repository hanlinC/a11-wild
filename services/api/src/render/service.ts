import type { Batch, BatchImage, Idea, Render, RenderKind } from "@a11-wild/shared";
import { requireMove } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import { estimateUsd, type FalClient } from "../fal/client.js";
import type { ImageStore } from "../images/store.js";
import { Refusal } from "../mcp/registry.js";
import type { Pictures } from "../pictures/store.js";
import { GateError, type GateStage, type SpendGate } from "../spend/gate.js";
import { NotBilledError, type SpendLedger } from "../spend/ledger.js";
import { toUsd } from "../spend/money.js";
import { RENDER_RULES, wordsAsked } from "./prompt-guard.js";
import { publicRender, type RenderStore, type StoredRender } from "./store.js";

export const DRAFTS_PER_IDEA = 3;
/** A final that fails its checks may be made again, this many times for one idea. */
export const FINALS_PER_IDEA = 3;
export const REFERENCES_MAX = 4;
/** fal reads a reference picture when the job starts, which can be some minutes after it is sent. */
const REFERENCE_LINK_SECONDS = 3600;

/** What decides whether a draft may become a final. The picks and the checks answer it. */
export interface FinalRule {
  /** Refuses unless the owner picked this draft and it has no D item. Returns how many finals the batch will make, and the picture the final is made from: the draft, or its repair. */
  allow(batch: Batch, ideaId: string, draft: BatchImage): Promise<{ finals: number; source: BatchImage }>;
}

export interface RenderRequest {
  batchId: string;
  ideaId: string;
  kind: RenderKind;
  prompt: string;
  /** A draft's skeleton, or the picked draft of a final. */
  fromId?: string;
  /** Other pictures the model sees: keys of the product's photos or the brand's logo. */
  /** Names of the product's photos and the brand's logo: "logo", "pack-1", "food-2". Never a key. */
  references: string[];
}

export interface RenderView extends Render {
  image?: BatchImage & { viewUrl: string };
  note?: string;
}

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  images: ImageStore;
  renders: RenderStore;
  ledger: SpendLedger;
  gate: SpendGate;
  fal: FalClient;
  pictures: Pictures;
  finals: FinalRule;
}

const STAGE: Record<RenderKind, GateStage> = { draft: "drafts", final: "finals" };
const live = (render: Render) => render.status !== "failed";

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
  private async passGate(batch: Batch, kind: RenderKind, sent: StoredRender[]): Promise<Batch> {
    const { gate, batches } = this.deps;
    const stage = STAGE[kind];
    if (!(await gate.peek(batch.id, stage))) {
      const first = sent.find((render) => render.status === "done");
      if (!first) {
        if (sent.length === 0) return batch;
        throw new GateError(`The first of the ${stage} is out to read the price. Read it with render_status until it is done, then send the rest.`);
      }
      // The price was not saved when the first render ended. Save it now from that render.
      await gate.price(batch.id, stage, { firstUsd: first.usd, count: first.stageCount });
    }
    if (kind === "draft" && batch.state === "judged") batch = await batches.move(batch, "priced", "render_submit");
    try {
      await gate.check(batch.id, stage);
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
    const idea: Idea | undefined = (await batches.ideas(batch.id)).find((saved) => saved.id === input.ideaId);
    if (!idea) throw new Refusal(`This batch has no idea ${input.ideaId}. batch_get gives its ideas.`);
    await fal.ready();

    const [product, brand, all] = await Promise.all([brands.product(batch.productId), brands.brand(batch.brandId), renders.list(batch.id)]);
    const sent = all.filter((render) => render.kind === input.kind && live(render));
    const mine = sent.filter((render) => render.ideaId === idea.id);
    let from: BatchImage | undefined;
    /** The picture the model sees in place of `from`: a picked draft's repair. */
    let source: BatchImage | undefined;
    let count: number;

    if (input.kind === "draft") {
      // Until the blind judge exists, a batch goes from its ideas straight to its drafts.
      if (batch.state === "ideas") batch = await batches.move(batch, "judged", "render_submit");
      if (!["judged", "priced", "waiting_spend", "drafting"].includes(batch.state)) requireMove(batch.state, "drafting", "render_submit");
      if (mine.length >= DRAFTS_PER_IDEA) throw new Refusal(`Idea ${idea.id} has its ${DRAFTS_PER_IDEA} drafts. A draft that failed can be sent again; one that is done cannot.`);
      const hasPack = product.photos.some((photo) => photo.kind === "pack");
      if (input.fromId) {
        from = await images.get(batch.id, input.fromId);
        if (from.kind !== "skeleton") throw new Refusal(`Picture ${from.id} is a ${from.kind}, not a skeleton. A draft is built round a skeleton (skeleton_make).`);
        if (mine.some((render) => render.fromId === from?.id)) {
          throw new Refusal("R23: each draft of an idea comes from its own skeleton. This skeleton already has a draft of this idea. Make another skeleton, with another camera, crop or scale.");
        }
      } else if (hasPack) {
        throw new Refusal("R29: this product has a pack photo, so each draft is built round a skeleton that holds the real pack. Make one with skeleton_make and give its id as fromId.");
      }
      count = (await batches.ideas(batch.id)).length * DRAFTS_PER_IDEA;
    } else {
      if (!["waiting_pick", "finals"].includes(batch.state)) requireMove(batch.state, "finals", "render_submit");
      if (!input.fromId) throw new Refusal("A final is made from the draft the owner picked. Give that draft's picture id as fromId.");
      from = await images.get(batch.id, input.fromId);
      if (from.kind !== "draft" || from.ideaId !== idea.id) throw new Refusal(`Picture ${from.id} is not a draft of idea ${idea.id}.`);
      const allowed = await finals.allow(batch, idea.id, from);
      count = allowed.finals;
      source = allowed.source;
      if (mine.length >= FINALS_PER_IDEA) throw new Refusal(`Idea ${idea.id} has had ${FINALS_PER_IDEA} finals. Tell the owner before more are made.`);
    }

    const named = input.references.map((name) => {
      const [kind, number] = name.split("-");
      const picture = kind === "logo" ? brand.logo : product.photos.filter((photo) => photo.kind === kind)[Number(number) - 1];
      if (!picture) throw new Refusal(`This ${kind === "logo" ? "brand has no logo" : `product has no ${kind} photo ${number}`}. A reference picture is the brand's logo ("logo") or one of this product's photos ("pack-1", "food-1").`);
      return picture.key;
    });
    const keys = [...new Set([...(from ? [(source ?? from).key] : []), ...named])];
    if (keys.length > REFERENCES_MAX) throw new Refusal(`A render takes ${REFERENCES_MAX} reference pictures or fewer.`);

    batch = await this.passGate(batch, input.kind, sent);

    const usd = estimateUsd(input.kind, keys.length);
    const reservation = await ledger.reserve({ service: "fal", kind: input.kind, ref: `${idea.id}: ${idea.title}`, batchId: batch.id, usd });
    let job;
    try {
      const referenceUrls = await Promise.all(keys.map((key) => pictures.viewUrl(key, REFERENCE_LINK_SECONDS)));
      job = await fal.submit({ kind: input.kind, prompt: `${input.prompt.trim()}\n\n${RENDER_RULES}`, referenceUrls });
    } catch (error) {
      // Only a sure refusal gives the money back. Any other failure may still be billed.
      if (error instanceof NotBilledError) await ledger.release(reservation);
      throw error;
    }
    const render = await renders.create({
      batchId: batch.id,
      ideaId: idea.id,
      kind: input.kind,
      prompt: input.prompt.trim(),
      ...(from ? { fromId: from.id } : {}),
      usd,
      fal: job,
      reservation,
      stageCount: count,
    });
    if (input.kind === "draft" && (batch.state === "priced" || batch.state === "waiting_spend")) await batches.move(batch, "drafting", "render_submit");
    if (input.kind === "final" && batch.state === "waiting_pick") await batches.move(batch, "finals", "render_submit");
    const alone = sent.length === 0 ? `This is the first of the ${STAGE[input.kind]}: it goes alone to read the price. Read it with render_status until it is done, then send the rest.` : undefined;
    return this.view(render, alone);
  }

  /** Reads a render. When fal is done, the picture is copied into the private store once and the ledger is settled once. */
  async status(batchId: string, renderId: string): Promise<RenderView> {
    const { renders, images, pictures, ledger, gate, batches, fal } = this.deps;
    const render = await renders.get(batchId, renderId);
    if (render.status !== "queued") return this.view(render);
    const result = await fal.poll(render.fal);
    if (result.state === "queued") return this.view(render, result.note ?? "fal is still making it; read again in a few seconds.");

    if (result.state === "failed") {
      // Only a sure refusal gives the money back. A picture that fal made and the studio could not copy was still billed.
      if (await renders.end(render, { status: "failed", error: result.error })) await (result.refund ? ledger.release(render.reservation) : ledger.settle(render.reservation));
      return this.view(await renders.get(batchId, renderId));
    }

    // The picture has the render's id, so a second read writes the same picture and adds no other.
    const key = `batches/${batchId}/${render.kind}s/${render.id}.${result.ext}`;
    await pictures.put(key, result.body, result.type);
    await images.add({ id: render.id, batchId, kind: render.kind, key, ideaId: render.ideaId, ...(render.fromId ? { fromId: render.fromId } : {}) });
    if (await renders.end(render, { status: "done", imageId: render.id })) {
      await ledger.settle(render.reservation);
      const stage = STAGE[render.kind];
      if (!(await gate.peek(batchId, stage))) {
        const batch = await batches.get(batchId);
        const state = await gate.price(batchId, stage, { firstUsd: toUsd(render.reservation.micro), count: render.stageCount });
        if (render.kind === "draft" && batch.state === "judged") await batches.move(batch, "priced", "render_status");
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
