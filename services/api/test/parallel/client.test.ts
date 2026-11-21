import { beforeEach, describe, expect, it } from "vitest";
import { ParallelClient, ProviderError } from "../../src/parallel/client.js";
import { MissingKeyError } from "../../src/secrets.js";
import { NotBilledError, SpendLedger } from "../../src/spend/ledger.js";
import { MemoryTable } from "../helpers/memory-table.js";
import { extractReply, fakeParallel, TEST_KEY, testKeys } from "../helpers/parallel.js";

let ledger: SpendLedger;
beforeEach(() => {
  ledger = new SpendLedger(new MemoryTable(), () => new Date("2026-11-22T03:00:00Z"));
});

describe("Parallel client", () => {
  it("extracts the full text of a page and records its price as spent", async () => {
    const parallel = fakeParallel(extractReply({ "https://brand.example/": "Kaya toast, 250 g." }));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);

    const result = await client.extract({ urls: ["https://brand.example/", "https://brand.example/gone"] });
    expect(result.pages).toEqual([{ url: "https://brand.example/", title: "A page", text: "Kaya toast, 250 g." }]);
    expect(result.failed).toEqual(["https://brand.example/gone"]);

    expect(parallel.calls[0]).toMatchObject({ url: "https://api.parallel.ai/v1/extract", method: "POST", key: TEST_KEY });
    expect(parallel.calls[0]?.body).toMatchObject({ advanced_settings: { full_content: { max_chars_per_result: 60_000 } } });
    const summary = await ledger.summary();
    expect(summary.monthUsd).toBe(0.002);
    expect(summary.lines[0]).toMatchObject({ service: "parallel", kind: "extract", status: "spent" });
  });

  it("releases the reserve when Parallel refuses, and its message never repeats the reply or the key", async () => {
    const parallel = fakeParallel(() => ({ status: 401, text: `bad key ${TEST_KEY} in request` }));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);

    const error = await client.search({ objective: "kaya", queries: ["kaya toast"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotBilledError);
    expect((error as Error).message).toBe("Parallel refused the search request (status 401). Nothing was charged.");
    expect(JSON.stringify(await ledger.summary())).not.toContain(TEST_KEY);
    expect(await ledger.summary()).toMatchObject({ monthUsd: 0, lines: [{ status: "released" }] });
  });

  it("keeps the reserve counted when no answer came, and hides the cause", async () => {
    const parallel = fakeParallel(() => new Error(`connect failed with header x-api-key: ${TEST_KEY}`));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);

    const error = await client.extract({ urls: ["https://brand.example/"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect(await ledger.summary()).toMatchObject({ monthUsd: 0.001, lines: [{ status: "reserved" }] });
  });

  it("sends nothing and reserves nothing when the key is not stored", async () => {
    const parallel = fakeParallel(() => ({}));
    const keys = { get: async () => Promise.reject(new MissingKeyError("parallel")) };
    const client = new ParallelClient(keys, ledger, parallel.fetchFn);
    await expect(client.search({ objective: "x", queries: ["x"] })).rejects.toThrow(MissingKeyError);
    expect(parallel.calls).toEqual([]);
    expect((await ledger.summary()).lines).toEqual([]);
  });

  it("sends nothing when the month's cap would be passed", async () => {
    await ledger.reserve({ service: "fal", kind: "final", ref: "x", usd: 24.9999 });
    const parallel = fakeParallel(() => ({}));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);
    await expect(client.search({ objective: "x", queries: ["x"], mode: "advanced" })).rejects.toThrow(/cap would be passed/);
    expect(parallel.calls).toEqual([]);
  });

  it("prices a search by its mode and returns pages with excerpts", async () => {
    const parallel = fakeParallel(() => ({
      json: { results: [{ url: "https://a.example/", title: "A", excerpts: ["one", "two"] }, { title: "no address" }] },
    }));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);
    const results = await client.search({ objective: "o", queries: ["q"], mode: "advanced", batchId: "b1" });
    expect(results).toEqual([{ url: "https://a.example/", title: "A", excerpts: ["one", "two"] }]);
    expect(parallel.calls[0]?.body).toEqual({ objective: "o", search_queries: ["q"], mode: "advanced" });
    expect(await ledger.summary("b1")).toMatchObject({ batchUsd: 0.005 });
  });

  it("finds pictures", async () => {
    const parallel = fakeParallel(() => ({
      json: { results: [{ image_url: "https://a.example/p.jpg", url: "https://a.example/", title: "P", width: 1600, height: 900 }] },
    }));
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);
    expect(await client.images({ objective: "o", queries: ["q"] })).toEqual([
      { imageUrl: "https://a.example/p.jpg", pageUrl: "https://a.example/", title: "P", width: 1600, height: 900 },
    ]);
    expect(parallel.calls[0]?.url).toBe("https://api.parallel.ai/v1/images/search");
  });

  it("starts a research run for one charge and reads its answer for free", async () => {
    const parallel = fakeParallel((call) => {
      if (call.method === "POST") return { json: { run_id: "trun_1", status: "queued" } };
      if (call.url.endsWith("/result")) {
        return { json: { output: { content: "250 g", basis: [{ field: "output", citations: [{ url: "https://a.example/" }] }] } } };
      }
      return { json: { run_id: "trun_1", status: "completed" } };
    });
    const client = new ParallelClient(testKeys, ledger, parallel.fetchFn);

    expect(await client.taskStart({ question: "Pack size?", processor: "base" })).toEqual({ runId: "trun_1", status: "queued" });
    expect(await client.taskGet("trun_1")).toEqual({
      runId: "trun_1",
      status: "completed",
      output: "250 g",
      basis: [{ field: "output", citations: [{ url: "https://a.example/" }] }],
    });
    expect((await ledger.summary()).monthUsd).toBe(0.01);
  });
});
