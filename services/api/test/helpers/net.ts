import type { Net } from "../../src/urlsafety.js";

export interface FakeNet extends Net {
  requested: string[];
}

type Page = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array };

/** A network of fixed pages. Every host resolves to a public address unless `addresses` says otherwise. */
export function fakeNet(pages: Record<string, Page>, addresses: Record<string, string[]> = {}): FakeNet {
  const requested: string[] = [];
  return {
    requested,
    resolve: async (hostname) => addresses[hostname] ?? ["93.184.216.34"],
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const page = pages[url];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page.body ?? null, { status: page.status ?? 200, headers: page.headers ?? {} });
    }) as typeof fetch,
  };
}
