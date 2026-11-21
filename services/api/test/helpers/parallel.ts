import type { ProviderKeys } from "../../src/secrets.js";

export const TEST_KEY = "parallel-test-key-0123456789";

export const testKeys: ProviderKeys = { get: async () => TEST_KEY };

export interface ParallelCall {
  url: string;
  method: string;
  key: string | null;
  body: Record<string, unknown> | undefined;
}

type Reply = { status?: number; json?: unknown; text?: string } | Error;

/** A stand-in for Parallel. `answer` gets each request and says what comes back. */
export function fakeParallel(answer: (call: ParallelCall) => Reply) {
  const calls: ParallelCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: ParallelCall = {
      url: String(input),
      method: init?.method ?? "GET",
      key: new Headers(init?.headers).get("x-api-key"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = answer(call);
    if (reply instanceof Error) throw reply;
    return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** Answers every extract with the given page texts, by address. */
export const extractReply = (pages: Record<string, string>) => (call: ParallelCall) => {
  const urls = (call.body?.urls as string[] | undefined) ?? [];
  return {
    json: {
      extract_id: "extract_test",
      results: urls.filter((url) => url in pages).map((url) => ({ url, title: "A page", excerpts: [], full_content: pages[url] })),
      errors: urls.filter((url) => !(url in pages)).map((url) => ({ url, error_type: "fetch_error", http_status_code: 404 })),
    },
  };
};
