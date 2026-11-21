import type { ClientRecord, Me } from "@a11-wild/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = (body as { error?: unknown } | undefined)?.error;
    throw new ApiError(response.status, typeof code === "string" ? code : "request_failed");
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
  logout: () => post<{ redirect: string }>("/auth/logout"),
};

/** A sentence for the person, from whatever went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session ended. Sign in again.";
    if (error.status === 403) return "Only the owner can do that.";
    if (error.status === 404) return "That connection no longer exists.";
  }
  return "That did not work. Try again in a moment.";
}
