import type { BatchSummary, Board, BrandPage, BrandSummary, CanonVersion, ClientRecord, Me, Pick, SpendSummary, TastePage } from "@a11-wild/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** A sentence the server wrote for the person, when it refused the request. */
    readonly detail?: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = (body as { error?: unknown } | undefined)?.error;
    const detail = (body as { message?: unknown } | undefined)?.message;
    throw new ApiError(response.status, typeof code === "string" ? code : "request_failed", typeof detail === "string" ? detail : undefined);
  }
  return body as T;
}

const post = <T>(path: string) => request<T>(path, { method: "POST" });

export const api = {
  me: () => request<Me>("/api/me"),
  health: () => request<{ ok: boolean; buildId: string }>("/api/health"),
  clients: async () => (await request<{ clients: ClientRecord[] }>("/api/clients")).clients,
  approveClient: async (clientId: string) =>
    (await post<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(clientId)}/approve`)).client,
  revokeClient: async (clientId: string) =>
    (await post<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(clientId)}/revoke`)).client,
  brands: async () => (await request<{ brands: BrandSummary[] }>("/api/brands")).brands,
  brand: (brandId: string) => request<BrandPage>(`/api/brands/${encodeURIComponent(brandId)}`),
  spend: () => request<SpendSummary>("/api/spend"),
  taste: () => request<TastePage>("/api/taste"),
  canonVersion: (version: number) => request<CanonVersion>(`/api/taste/canon/${version}`),
  saveCanon: (text: string, reason: string) =>
    request<CanonVersion>("/api/taste/canon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, reason }),
    }),
  batches: async () => (await request<{ batches: BatchSummary[] }>("/api/batches")).batches,
  board: (batchId: string) => request<Board>(`/api/batches/${encodeURIComponent(batchId)}/board`),
  pick: (batchId: string, pick: { ideaId: string; imageId: string | null; ownerSaid: string }) =>
    request<{ pick: Pick; note?: string }>(`/api/batches/${encodeURIComponent(batchId)}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pick),
    }),
  logout: () => post<{ redirect: string }>("/auth/logout"),
};

/** A sentence for the person, from whatever went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.detail) return error.detail;
    if (error.status === 401) return "Your session ended. Sign in again.";
    if (error.status === 403) return "Only the owner can do that.";
    if (error.status === 404) return "That is no longer there.";
  }
  return "That did not work. Try again in a moment.";
}
