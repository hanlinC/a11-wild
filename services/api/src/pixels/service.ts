import { createHash, randomUUID } from "node:crypto";
import type { BatchImage, ImageKind, PixelJob, PixelTool } from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { BoardService } from "../board/service.js";
import type { BrandStore } from "../brand/store.js";
import type { CheckStore } from "../checks/store.js";
import type { ImageStore } from "../images/store.js";
import { Refusal } from "../mcp/registry.js";
import type { Pictures } from "../pictures/store.js";
import type { PixelRunner } from "./runner.js";
import { type JobStore, jobView, type StoredJob } from "./store.js";

/** A job with no result after this long did not run to its end. */
const JOB_MINUTES = 10;
const RESULT_BYTES = 20_000;
const RENDERED: ImageKind[] = ["draft", "final", "reprint", "swap"];
const SKELETON_STATES = ["ideas", "judged", "priced", "waiting_spend", "drafting"];

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  images: ImageStore;
  checks: CheckStore;
  board: BoardService;
  jobs: JobStore;
  pictures: Pictures;
  /** Missing where the pixel function is not deployed. */
  runner: PixelRunner | undefined;
  now: () => Date;
}

/** What the pixel function wrote for a job. */
interface PixelResult {
  ok: boolean;
  line?: string;
  passed?: boolean;
  imageKey?: string;
  error?: string;
}

export type PixelView = PixelJob & { image?: BatchImage & { viewUrl: string }; next?: string; state?: string; stillMissing?: string[] };

/** The pixel scripts read a plan's colours with their "#". */
const hashed = (colour: unknown) => `#${String(colour).replace("#", "")}`;
function planColours(plan: unknown): unknown {
  if (typeof plan !== "object" || plan === null) return plan;
  const { bg, shapes, ...rest } = plan as { bg?: unknown; shapes?: { fill?: unknown }[] };
  return { ...rest, bg: hashed(bg), shapes: (shapes ?? []).map((shape) => ({ ...shape, fill: hashed(shape.fill) })) };
}

/** A whole number from a picture's id, so the same picture gets the same grain each time. */
const seedOf = (imageId: string) => createHash("sha256").update(imageId).digest().readUInt32BE(0);

/**
 * The pixel tools: the real pack in a skeleton, the pack and cap measures, the repairs, the real-camera finish and the food crop.
 * Each one runs as a job in the pixel function. What a check measured goes into the picture's checks, where no agent can clear it.
 */
export class PixelService {
  constructor(private readonly deps: Deps) {}

  private async packKey(batchId: string): Promise<string> {
    const { batches, brands } = this.deps;
    const product = await brands.product((await batches.get(batchId)).productId);
    const pack = product.photos.find((photo) => photo.kind === "pack");
    if (!pack) throw new Refusal("This product has no pack photo. Save one with product_photos_save first: the tool needs the real pack.");
    return pack.key;
  }

  /** A draft, a final or a repair of one: a picture a check or a repair can work on. */
  private async rendered(batchId: string, imageId: string): Promise<BatchImage> {
    const image = await this.deps.images.get(batchId, imageId);
    if (!RENDERED.includes(image.kind)) throw new Refusal(`Picture ${imageId} is a ${image.kind}. This tool works on a draft, a final, or a reprint or swap of one.`);
    return image;
  }

  private async start(
    tool: PixelTool,
    batchId: string,
    input: Record<string, unknown>,
    about: { imageId?: string; out?: Omit<NonNullable<StoredJob["out"]>, "key"> },
  ): Promise<PixelView> {
    const { jobs, runner } = this.deps;
    if (!runner) throw new Refusal("The pixel tools are not deployed in this studio.");
    const id = randomUUID();
    const job = await jobs.add({
      id,
      batchId,
      tool,
      input,
      resultKey: `jobs/${batchId}/${id}.json`,
      ...(about.imageId ? { imageId: about.imageId } : {}),
      ...(about.out ? { out: { ...about.out, key: `batches/${batchId}/${about.out.kind}s/${id}.jpg` } } : {}),
    });
    await runner.start({ jobId: id, batchId, tool, input, resultKey: job.resultKey, ...(job.out ? { outKey: job.out.key } : {}) });
    return { ...jobView(job), next: "pixel_status reads the result. It takes a few seconds." };
  }

  /** The draft or final a picture stands for. */
  private root = (image: BatchImage) => image.rootId ?? image.id;

  async skeleton(input: { batchId: string; ideaId: string; placement: Record<string, unknown> }): Promise<PixelView> {
    const { batches } = this.deps;
    const batch = await batches.get(input.batchId);
    if (!SKELETON_STATES.includes(batch.state)) throw new Refusal(`A skeleton is made before a draft. This batch is at "${batch.state}".`);
    if (!(await batches.ideas(batch.id)).some((idea) => idea.id === input.ideaId)) throw new Refusal(`This batch has no idea ${input.ideaId}.`);
    if (!input.placement.plan && !input.placement.bg) throw new Refusal("A skeleton needs the canvas colour (bg), or a plan that has one.");
    const placement = input.placement.plan ? { ...input.placement, plan: planColours(input.placement.plan) } : input.placement;
    return this.start("skeleton", batch.id, { ...placement, packKey: await this.packKey(batch.id) }, { out: { kind: "skeleton", ideaId: input.ideaId } });
  }

  async packCheck(input: { batchId: string; imageId: string; at: [number, number]; bg: string; sideways: boolean; box?: number[] }): Promise<PixelView> {
    const image = await this.rendered(input.batchId, input.imageId);
    const { batchId: _batchId, imageId: _imageId, box: around, ...rest } = input;
    // `box` in a job is the pack's box in the pack photo, so the box round the drawn pack goes as `around`.
    return this.start("pack_check", input.batchId, { ...rest, ...(around ? { around } : {}), ...(await this.packOf(input.batchId, image)), renderKey: image.key }, { imageId: image.id });
  }

  async capCheck(input: { batchId: string; imageId: string; box: number[]; split: number }): Promise<PixelView> {
    const image = await this.rendered(input.batchId, input.imageId);
    return this.start("cap_check", input.batchId, { box: input.box, split: input.split, renderKey: image.key }, { imageId: image.id });
  }

  /** What the skeleton of a picture was made with, through its draft when the picture is a final or a repair. */
  private async skeletonOf(batchId: string, image: BatchImage): Promise<Record<string, unknown>> {
    const { images, jobs } = this.deps;
    let at: BatchImage | undefined = image;
    for (let step = 0; at && at.kind !== "skeleton" && step < 6; step += 1) at = at.fromId ? await images.get(batchId, at.fromId) : undefined;
    return at ? (await jobs.get(batchId, at.id)).input : {};
  }

  /** The pack photo, cut out the same way as for the picture's skeleton: its tuning and its box are carried to each later tool. */
  private async packOf(batchId: string, image: BatchImage): Promise<Record<string, unknown>> {
    const { cutout, box } = await this.skeletonOf(batchId, image);
    return { packKey: await this.packKey(batchId), ...(cutout ? { cutout } : {}), ...(box ? { box } : {}) };
  }

  private async planOf(batchId: string, image: BatchImage): Promise<unknown> {
    const { plan } = await this.skeletonOf(batchId, image);
    if (!plan) throw new Refusal("A reprint needs the plan of the skeleton the picture was built round. This picture's skeleton was made without a plan: repair it with product_swap, or render it again.");
    return plan;
  }

  async reprint(input: { batchId: string; imageId: string; face: number[] }): Promise<PixelView> {
    const image = await this.rendered(input.batchId, input.imageId);
    const plan = await this.planOf(input.batchId, image);
    return this.start(
      "reprint",
      input.batchId,
      { face: input.face, plan, ...(await this.packOf(input.batchId, image)), renderKey: image.key },
      { imageId: image.id, out: { kind: "reprint", fromId: image.id, rootId: this.root(image), ...(image.ideaId ? { ideaId: image.ideaId } : {}) } },
    );
  }

  async swap(input: { batchId: string; imageId: string; old: number[]; scale?: number; cx?: number; lowerOnly: boolean; bandTop?: number }): Promise<PixelView> {
    const image = await this.rendered(input.batchId, input.imageId);
    const { batchId: _batchId, imageId: _imageId, ...rest } = input;
    return this.start(
      "swap",
      input.batchId,
      { ...rest, ...(await this.packOf(input.batchId, image)), renderKey: image.key },
      { imageId: image.id, out: { kind: "swap", fromId: image.id, rootId: this.root(image), ...(image.ideaId ? { ideaId: image.ideaId } : {}) } },
    );
  }

  async finish(input: { batchId: string; imageId: string; strength: number; sharp: number[][]; keep: string[] }): Promise<PixelView> {
    const { images } = this.deps;
    const image = await this.rendered(input.batchId, input.imageId);
    const root = image.rootId ? await images.get(input.batchId, image.rootId) : image;
    if (root.kind !== "final") throw new Refusal("The real-camera finish goes on a final, or on a repair of a final. A draft stays as the model made it.");
    return this.start(
      "photo_finish",
      input.batchId,
      { strength: input.strength, sharp: input.sharp, keep: input.keep, seed: seedOf(root.id), renderKey: image.key },
      { imageId: image.id, out: { kind: "finish", fromId: image.id, rootId: root.id, ...(image.ideaId ? { ideaId: image.ideaId } : {}) } },
    );
  }

  async foodCrop(input: { batchId: string; imageId: string; box: number[]; photo: number }): Promise<PixelView> {
    const { batches, brands } = this.deps;
    const image = await this.rendered(input.batchId, input.imageId);
    const food = (await brands.product((await batches.get(input.batchId)).productId)).photos.filter((photo) => photo.kind === "food");
    const chosen = food[input.photo - 1];
    if (!chosen) throw new Refusal(food.length === 0 ? "This product has no food photo of the brand's own to compare with. Save one with product_photos_save." : `This product has ${food.length} food photo(s). Give a number from 1 to ${food.length}.`);
    return this.start(
      "food_crop",
      input.batchId,
      { box: input.box, renderKey: image.key, foodKey: chosen.key },
      { imageId: image.id, out: { kind: "food_crop", fromId: image.id, rootId: this.root(image), ...(image.ideaId ? { ideaId: image.ideaId } : {}) } },
    );
  }

  private async result(job: StoredJob): Promise<PixelResult | undefined> {
    const body = await this.deps.pictures.read(job.resultKey, RESULT_BYTES);
    if (!body) return undefined;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      if (typeof parsed === "object" && parsed !== null && typeof (parsed as PixelResult).ok === "boolean") return parsed as PixelResult;
    } catch {
      // An unreadable result is a failed job.
    }
    return { ok: false, error: "The tool's result could not be read." };
  }

  /** Reads a job. The first read after it ends saves what it made or measured, one time. */
  async status(batchId: string, jobId: string): Promise<PixelView> {
    const { jobs, images, checks, pictures, batches, board, now } = this.deps;
    let job = await jobs.get(batchId, jobId);
    if (job.status === "queued") {
      const result = await this.result(job);
      if (!result) {
        if (now().getTime() - Date.parse(job.createdAt) < JOB_MINUTES * 60_000) return { ...jobView(job), next: "Read again in a few seconds." };
        job = (await jobs.end(job, { status: "failed", error: "The tool did not answer. Send it again." })) ?? (await jobs.get(batchId, jobId));
      } else if (!result.ok || (job.out && result.imageKey !== job.out.key) || (!job.out && typeof result.passed !== "boolean")) {
        job = (await jobs.end(job, { status: "failed", error: String(result.error ?? "The tool gave no result.").slice(0, 600) })) ?? (await jobs.get(batchId, jobId));
      } else {
        const line = String(result.line ?? "").slice(0, 600);
        // What the job made or measured is saved before the job ends, so a read that stops half way is done again by the next one. Each write gives the same row again.
        if (job.out) {
          const { key, kind, ideaId, fromId, rootId } = job.out;
          await images.add({ id: job.id, batchId, kind, key, ...(ideaId ? { ideaId } : {}), ...(fromId ? { fromId } : {}), ...(rootId ? { rootId } : {}) });
        } else if (job.imageId) {
          // D11 is the product drawn wrong: the pack's shape, and where the cap sits.
          await checks.measure(batchId, job.imageId, job.tool, result.passed === true ? null : { code: "D11", note: line }, job.createdAt);
        }
        const ended = await jobs.end(job, { status: "done", line, ...(job.out ? { madeId: job.id } : { passed: result.passed === true }) });
        job = ended ?? (await jobs.get(batchId, jobId));
      }
    }
    const view: PixelView = jobView(job);
    if (job.status === "done" && job.madeId) {
      const image = await images.get(batchId, job.madeId);
      view.image = { ...image, viewUrl: await pictures.viewUrl(image.key) };
    }
    if (job.status === "done" && job.tool !== "skeleton" && job.tool !== "food_crop") {
      const { batch, missing } = await board.progress(await batches.get(batchId));
      view.state = batch.state;
      if (missing.length > 0) view.stillMissing = missing;
    }
    return view;
  }
}
