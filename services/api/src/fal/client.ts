import type { RenderKind } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { MAX_PICTURE_BYTES, pictureType } from "../pictures/store.js";
import type { ProviderKeys } from "../secrets.js";
import { NotBilledError } from "../spend/ledger.js";
import { readCapped } from "../urlsafety.js";

const QUEUE = "https://queue.fal.run";
export const FAL_MODEL = "openai/gpt-image-2.5/sunburst";

/** 4:5 sizes. Both sides are multiples of 16, as the model needs. */
export const SIZES = {
  rough: { width: 1024, height: 1280, quality: "low" },
  draft: { width: 1024, height: 1280, quality: "low" },
  final: { width: 1536, height: 1920, quality: "high" },
} as const satisfies Record<RenderKind, { width: number; height: number; quality: string }>;

/**
 * fal's list prices in US dollars, as a11-adgen measured them. fal reports no price with a
 * result, so the ledger holds this estimate for each render.
 */
export const FAL_PRICES = { draftImage: 0.006, finalImage: 0.06, reference: 0.01, prompt: 0.003 } as const;

export function estimateUsd(kind: RenderKind, references: number): number {
  const image = kind === "final" ? FAL_PRICES.finalImage : FAL_PRICES.draftImage;
  return Number((image + FAL_PRICES.reference * references + FAL_PRICES.prompt).toFixed(4));
}

/** fal did not give a usable answer and the outcome is not known, so the render stays counted. */
export class FalError extends Refusal {}

/** Where fal keeps a job. Both addresses come from fal's own answer and are checked before each use. */
export interface FalJob {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

export type FalState =
  | { state: "queued"; note?: string }
  /** `refund` is set only when fal surely made no picture. Any other failure may still be billed, so its money stays spent. */
  | { state: "failed"; error: string; refund?: true }
  | { state: "done"; body: Uint8Array; type: string; ext: string };

/** The queue gets the key, so only its exact host passes. */
const isQueueHost = (host: string) => host === "queue.fal.run";
/** fal serves result pictures from fal.media and its subdomains. */
const isImageHost = (host: string) => host === "fal.media" || host.endsWith(".fal.media");
const REDIRECTS = 3;
const transient = (status: number) => status === 429 || status >= 500;

/**
 * The only path to fal. An address from a fal answer is not trusted: it must be https on the fal
 * host for its purpose, and each redirect is checked before the request, and the key, go out.
 * An error reply reaches the agent as its status only, never as its text.
 */
export class FalClient {
  constructor(
    private readonly keys: ProviderKeys,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly timeoutMs = 25_000,
  ) {}

  /** Refuses with a plain message when the owner has not stored the key. Nothing is sent. */
  async ready(): Promise<void> {
    await this.keys.get("fal");
  }

  private async get(url: string, what: string, allowed: (host: string) => boolean, withKey: boolean): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const headers = withKey ? { authorization: `Key ${await this.keys.get("fal")}` } : undefined;
    let at = url;
    for (let hop = 0; hop <= REDIRECTS; hop++) {
      const parsed = URL.canParse(at) ? new URL(at) : undefined;
      if (parsed?.protocol !== "https:" || !allowed(parsed.hostname)) throw new FalError(`${what} is not at an https fal address, so the studio did not open it.`);
      const response = await this.fetchFn(at, { ...(headers ? { headers } : {}), redirect: "manual", signal });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) return response;
      await response.body?.cancel();
      at = new URL(location, parsed).href;
    }
    throw new FalError(`${what} redirected too many times.`);
  }

  /** Puts one render in fal's queue. With reference pictures the model edits round them; with none it works from the words alone. */
  async submit(input: { kind: RenderKind; prompt: string; referenceUrls: string[] }): Promise<FalJob> {
    const key = await this.keys.get("fal");
    const size = SIZES[input.kind];
    let response: Response;
    try {
      response = await this.fetchFn(`${QUEUE}/${FAL_MODEL}/${input.referenceUrls.length > 0 ? "edit" : "text-to-image"}`, {
        method: "POST",
        headers: { authorization: `Key ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          ...(input.referenceUrls.length > 0 ? { image_urls: input.referenceUrls } : {}),
          image_size: { width: size.width, height: size.height },
          quality: size.quality,
          num_images: 1,
          output_format: "jpeg",
          output_compression: 90,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new FalError("fal did not answer the render request. Its outcome is not known, so it stays counted in the ledger. Do not send it again before render_list shows what the batch has.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      // A 4xx refuses the job. After a 5xx it is not sure that the queue did not take it.
      if (response.status >= 400 && response.status < 500) throw new NotBilledError(`fal refused the render request (status ${response.status}). Nothing was charged.`);
      throw new FalError(`fal failed on the render request (status ${response.status}). Its outcome is not known, so it stays counted in the ledger.`);
    }
    const reply = (await response.json().catch(() => undefined)) as { request_id?: unknown; status_url?: unknown; response_url?: unknown } | undefined;
    if (typeof reply?.request_id !== "string" || typeof reply.status_url !== "string" || typeof reply.response_url !== "string") {
      throw new FalError("fal's answer to the render request could not be read. It stays counted in the ledger.");
    }
    return { requestId: reply.request_id, statusUrl: reply.status_url, responseUrl: reply.response_url };
  }

  /** Reads a job once. A busy or failing fal leaves the job queued, so the next read tries again. */
  async poll(job: FalJob): Promise<FalState> {
    let status: Response;
    try {
      status = await this.get(job.statusUrl, "fal's status address", isQueueHost, true);
    } catch (error) {
      // An address that is not fal's never becomes good: the render fails now.
      if (error instanceof FalError) return { state: "failed", error: error.message };
      return { state: "queued", note: "fal did not answer; read again." };
    }
    if (!status.ok && status.status !== 202) {
      await status.body?.cancel();
      return transient(status.status) ? { state: "queued", note: `fal is busy (status ${status.status}); read again.` } : { state: "failed", error: `fal's status read failed (status ${status.status}).` };
    }
    const state = (await status.json().catch(() => undefined)) as { status?: unknown } | undefined;
    if (state?.status !== "COMPLETED") return { state: "queued" };

    let picture: Response;
    try {
      const result = await this.get(job.responseUrl, "fal's result address", isQueueHost, true);
      if (!result.ok) {
        await result.body?.cancel();
        return transient(result.status)
          ? { state: "queued", note: `fal is busy (status ${result.status}); read again.` }
          : { state: "failed", refund: true, error: `fal did not make the picture (status ${result.status}). The prompt or a reference picture may be one the model refuses.` };
      }
      const data = (await result.json().catch(() => undefined)) as { images?: { url?: unknown }[] } | undefined;
      const url = data?.images?.[0]?.url;
      if (typeof url !== "string") return { state: "failed", error: "fal returned no picture." };
      picture = await this.get(url, "fal's picture", isImageHost, false);
      if (!picture.ok) {
        await picture.body?.cancel();
        return transient(picture.status) ? { state: "queued", note: `The picture is not ready to copy (status ${picture.status}); read again.` } : { state: "failed", error: `fal's picture could not be copied (status ${picture.status}).` };
      }
    } catch (error) {
      if (error instanceof FalError) return { state: "failed", error: error.message };
      return { state: "queued", note: "fal did not answer; read again." };
    }
    let body: Uint8Array;
    try {
      body = await readCapped(picture, "fal's picture", MAX_PICTURE_BYTES);
    } catch (error) {
      return error instanceof Refusal ? { state: "failed", error: error.message } : { state: "queued", note: "The copy stopped half way; read again." };
    }
    const kind = pictureType(body);
    if (!kind) return { state: "failed", error: "What fal returned is not a PNG, JPEG or WebP picture." };
    return { state: "done", body, type: kind.type, ext: kind.ext };
  }
}
