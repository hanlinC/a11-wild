import { Refusal } from "../mcp/registry.js";
import type { ProviderKeys } from "../secrets.js";
import type { SpendGate } from "../spend/gate.js";
import { NotBilledError, type SpendLedger } from "../spend/ledger.js";
import { toMicro } from "../spend/money.js";

const BASE = "https://api.parallel.ai";

/** Parallel's list prices in US dollars for one request, read from its pricing page on 22-11-2026. */
export const PRICES = {
  extractUrl: 0.001,
  search: { fast: 0.001, advanced: 0.005 },
  images: { fast: 0.001, advanced: 0.005 },
  task: { lite: 0.005, base: 0.01, core: 0.025, pro: 0.1 },
} as const;

export type SearchMode = keyof typeof PRICES.search;
export type TaskProcessor = keyof typeof PRICES.task;

/** Parallel did not give a usable answer and the outcome is not known, so the call stays counted. */
export class ProviderError extends Refusal {}

export interface ExtractedPage {
  url: string;
  title: string | null;
  text: string;
}

export interface SearchResult {
  url: string;
  title: string | null;
  excerpts: string[];
}

export interface ImageResult {
  imageUrl: string;
  pageUrl: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
}

export interface TaskRun {
  runId: string;
  status: string;
  /** Present when the run is complete. */
  output?: unknown;
  /** For each answer: the pages it came from, with the excerpts Parallel read. */
  basis?: unknown;
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];

/**
 * The only path to Parallel. Each call reserves its price in the ledger before it is sent.
 * An error reply never reaches the agent or the log as text, because a provider can echo the
 * request, and the request carries the key.
 */
export class ParallelClient {
  constructor(
    private readonly keys: ProviderKeys,
    private readonly ledger: SpendLedger,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    /** Holds research at each US$1 until the owner says yes: by batch, or by month when it belongs to no batch. */
    private readonly gate?: SpendGate,
    private readonly timeoutMs = 25_000,
  ) {}

  private async send(kind: string, method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    const key = await this.keys.get("parallel");
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE}${path}`, {
        method,
        headers: { "x-api-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderError(`Parallel did not answer the ${kind} request. Its outcome is not known, so it stays counted in the ledger.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new NotBilledError(`Parallel refused the ${kind} request (status ${response.status}). Nothing was charged.`);
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ProviderError(`Parallel's answer to the ${kind} request could not be read. It stays counted in the ledger.`);
    }
  }

  private async paid<T>(
    kind: string,
    ref: string,
    usd: number,
    batchId: string | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    // Read the key first: with no key there is nothing to send, so nothing to reserve.
    await this.keys.get("parallel");
    if (this.gate) await this.gate.research(batchId, await this.ledger.batchMicro(batchId, "parallel"), toMicro(usd));
    return this.ledger.paid({ service: "parallel", kind, ref, usd, ...(batchId ? { batchId } : {}) }, async () => ({
      value: await call(),
    }));
  }

  /** The full text of each page. A page Parallel could not read is in `failed`. */
  async extract(input: { urls: string[]; objective?: string; batchId?: string; maxChars?: number }): Promise<{
    pages: ExtractedPage[];
    failed: string[];
  }> {
    const usd = PRICES.extractUrl * input.urls.length;
    return this.paid("extract", input.urls[0] ?? "", usd, input.batchId, async () => {
      const reply = await this.send("extract", "POST", "/v1/extract", {
        urls: input.urls,
        ...(input.objective ? { objective: input.objective } : {}),
        advanced_settings: { full_content: { max_chars_per_result: input.maxChars ?? 60_000 } },
      });
      const pages = list(reply.results).flatMap((result): ExtractedPage[] => {
        const url = str(result.url);
        const text = str(result.full_content) ?? (Array.isArray(result.excerpts) ? result.excerpts.join("\n\n") : "");
        return url && text ? [{ url, title: str(result.title), text }] : [];
      });
      const read = new Set(pages.map((page) => page.url));
      const failed = [
        ...new Set([...list(reply.errors).flatMap((error) => str(error.url) ?? []), ...input.urls.filter((url) => !read.has(url))]),
      ].filter((url) => !read.has(url));
      return { pages, failed };
    });
  }

  async search(input: { objective: string; queries: string[]; mode?: SearchMode; batchId?: string }): Promise<SearchResult[]> {
    const mode = input.mode ?? "fast";
    return this.paid("search", input.objective, PRICES.search[mode], input.batchId, async () => {
      const reply = await this.send("search", "POST", "/v1/search", {
        objective: input.objective,
        search_queries: input.queries,
        mode,
      });
      return list(reply.results).flatMap((result): SearchResult[] => {
        const url = str(result.url);
        const excerpts = Array.isArray(result.excerpts) ? result.excerpts.filter((x): x is string => typeof x === "string") : [];
        return url ? [{ url, title: str(result.title), excerpts }] : [];
      });
    });
  }

  async images(input: { objective: string; queries: string[]; mode?: SearchMode; batchId?: string }): Promise<ImageResult[]> {
    const mode = input.mode ?? "fast";
    return this.paid("images", input.objective, PRICES.images[mode], input.batchId, async () => {
      const reply = await this.send("images", "POST", "/v1/images/search", {
        objective: input.objective,
        search_queries: input.queries,
        mode,
      });
      return list(reply.results).flatMap((result): ImageResult[] => {
        const imageUrl = str(result.image_url);
        return imageUrl
          ? [{ imageUrl, pageUrl: str(result.url) ?? str(result.source_url), title: str(result.title), width: num(result.width), height: num(result.height) }]
          : [];
      });
    });
  }

  /** Starts a research run. Parallel charges one run; reading its result later is free. */
  async taskStart(input: { question: string; processor: TaskProcessor; batchId?: string }): Promise<TaskRun> {
    return this.paid("task", input.question, PRICES.task[input.processor], input.batchId, async () => {
      const reply = await this.send("task", "POST", "/v1/tasks/runs", {
        input: input.question,
        processor: input.processor,
        task_spec: { output_schema: { type: "text" } },
      });
      const runId = str(reply.run_id);
      if (!runId) throw new ProviderError("Parallel started no research run. It stays counted in the ledger.");
      return { runId, status: str(reply.status) ?? "queued" };
    });
  }

  /** The state of a research run and, when it is complete, its answer with the pages it cites. */
  async taskGet(runId: string): Promise<TaskRun> {
    const id = encodeURIComponent(runId);
    const run = await this.send("task status", "GET", `/v1/tasks/runs/${id}`);
    const status = str(run.status) ?? "unknown";
    if (status !== "completed") return { runId, status };
    const reply = await this.send("task result", "GET", `/v1/tasks/runs/${id}/result`);
    const output = (reply.output ?? {}) as Record<string, unknown>;
    return { runId, status, output: output.content, basis: output.basis };
  }
}
