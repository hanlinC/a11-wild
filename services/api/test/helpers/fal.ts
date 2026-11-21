export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export interface FalCall {
  url: string;
  method: string;
  key: string | null;
  body: Record<string, unknown> | undefined;
}

type Reply = { status?: number; json?: unknown; bytes?: Uint8Array; location?: string } | Error;

/**
 * A stand-in for fal's queue. By default each job is taken, is done at its first read and gives a
 * small JPEG. `answer` can change any reply: return nothing to keep the default.
 */
export function fakeFal(answer: (call: FalCall) => Reply | undefined = () => undefined) {
  const calls: FalCall[] = [];
  let jobs = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: FalCall = {
      url: String(input),
      method: init?.method ?? "GET",
      key: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    let reply = answer(call);
    if (!reply) {
      if (call.method === "POST") {
        const id = `req-${++jobs}`;
        reply = { json: { request_id: id, status_url: `https://queue.fal.run/requests/${id}/status`, response_url: `https://queue.fal.run/requests/${id}` } };
      } else if (call.url.endsWith("/status")) reply = { json: { status: "COMPLETED" } };
      else if (call.url.startsWith("https://queue.fal.run/")) reply = { json: { images: [{ url: `https://v3.fal.media/files/${call.url.split("/").pop()}.jpg` }] } };
      else reply = { bytes: JPEG };
    }
    if (reply instanceof Error) throw reply;
    if (reply.location) return new Response(null, { status: reply.status ?? 302, headers: { location: reply.location } });
    return new Response(reply.bytes ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetchFn, calls, submits: () => calls.filter((call) => call.method === "POST") };
}
