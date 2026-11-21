import type { ClientRecord, Me } from "@a11-wild/shared";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { SessionProvider } from "@/lib/session";

export const OWNER: Me = { email: "owner@example.com", role: "owner" };
export const MEMBER: Me = { email: "member@example.com", role: "member" };

export function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    clientId: "client-1",
    name: "Devin",
    callbackUrls: ["https://agent.example.com/callback"],
    status: "pending",
    firstSeenAt: "2026-11-21T10:00:00.000Z",
    firstSeenBy: "owner@example.com",
    ...overrides,
  };
}

export function renderSignedIn(ui: ReactNode, me: Me = OWNER, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider value={me}>{ui}</SessionProvider>
    </MemoryRouter>,
  );
}

/** A handler gets what the page sent as JSON, when it sent any. */
type Handler = (sent?: unknown) => { status?: number; body: unknown };

/** Replaces fetch with a table of "METHOD /path" answers and records the calls made. */
export function stubApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) return Response.json({ error: "not_found" }, { status: 404 });
    const { status = 200, body } = handler(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return Response.json(body, { status });
  });
  return calls;
}
