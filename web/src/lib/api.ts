import type { ChangeKind, ChangeStatus, ClientLink, ClientView, OwnerClient, PackComment, PackFormat, ShownComment, UploadTable, OutreachStage, OutreachStep, OutreachTemplates, OutreachTier, ProspectPage, ProspectsPage, TemplatesPage, TodayPage, BatchSummary, Board, BrandNote, BrandPage, CanonProposal, CanonScope, ConceptBoard, BrandSummary, CalibrationPage, CanonVersion, ClientRecord, DoneReport, Me, PackSummary, PackView, Pick, SpendSummary, TastePage } from "@a11-wild/shared";

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
const send = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A write on one prospect, by the name of its route. The answer is the prospect as it now stands. */
export type ProspectWrite =
  | { action: "ad"; body: { ad: number; yes: boolean; ownerSaid?: string } }
  | { action: "sent"; body: { step: OutreachStep; title: 0 | 1 } }
  | { action: "unsent"; body: { step: OutreachStep } }
  | { action: "reply"; body: { reply: "more" | "no" | "other"; text?: string } }
  | { action: "stage"; body: { stage: "in_talks" | "client" | "lost" | "parked" | "auto"; reason?: string } }
  | { action: "note"; body: { text: string } }
  | { action: "channel"; body: { channel: "whatsapp" | "email" } }
  | { action: "kind"; body: { kind: "product" | "service" } }
  | { action: "answered" | "optout" | "choose"; body?: undefined };

export interface ProspectFilter {
  q?: string;
  tier?: OutreachTier;
  sector?: string;
  stage?: OutreachStage;
}

export const api = {
  outreachToday: () => request<TodayPage>("/api/outreach/today"),
  prospects: (filter: ProspectFilter = {}) => {
    const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value)).toString();
    return request<ProspectsPage>(`/api/outreach/prospects${query ? `?${query}` : ""}`);
  },
  prospect: (id: string) => request<ProspectPage>(`/api/outreach/prospects/${encodeURIComponent(id)}`),
  prospectWrite: (id: string, write: ProspectWrite) => send<ProspectPage>(`/api/outreach/prospects/${encodeURIComponent(id)}/${write.action}`, write.body ?? {}),
  removeTestProspect: (id: string) => send<{ removed: boolean }>(`/api/outreach/prospects/${encodeURIComponent(id)}/remove`, {}),
  makeTestProspect: (contact: { whatsapp?: string; email?: string }) => send<{ id: string }>("/api/outreach/test-prospect", contact),
  outreachTemplates: () => request<TemplatesPage>("/api/outreach/templates"),
  saveOutreachTemplates: (steps: OutreachTemplates["steps"]) => send<{ templates: OutreachTemplates }>("/api/outreach/templates", { steps }),
  setOutreachDaily: (daily: number) => send<{ daily: number }>("/api/outreach/daily", { daily }),
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
  canonVersion: (version: number, scope?: CanonScope) =>
    request<CanonVersion>(`/api/taste/canon/${version}${scope ? `?${new URLSearchParams({ kind: scope.kind, ...(scope.brandId ? { brandId: scope.brandId } : {}) }).toString()}` : ""}`),
  saveCanon: (text: string, reason: string, scope?: CanonScope) => send<CanonVersion>("/api/taste/canon", { text, reason, ...(scope ? { scope } : {}) }),
  restoreCanon: (version: number, reason: string, scope?: CanonScope) => send<CanonVersion>("/api/taste/canon/restore", { version, reason, ...(scope ? { scope } : {}) }),
  decideProposal: (id: string, approve: boolean, ownerSaid: string) => send<{ proposal: CanonProposal }>(`/api/taste/proposals/${encodeURIComponent(id)}`, { approve, ownerSaid }),
  brandNote: (brandId: string, note: string) => send<BrandNote>(`/api/brands/${encodeURIComponent(brandId)}/notes`, { note }),
  batches: async () => (await request<{ batches: BatchSummary[] }>("/api/batches")).batches,
  board: (batchId: string) => request<Board>(`/api/batches/${encodeURIComponent(batchId)}/board`),
  pick: (batchId: string, pick: { ideaId: string; imageId: string | null; ownerSaid: string }) =>
    request<{ pick: Pick; note?: string }>(`/api/batches/${encodeURIComponent(batchId)}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pick),
    }),
  concepts: (batchId: string) => request<ConceptBoard>(`/api/batches/${encodeURIComponent(batchId)}/concepts`),
  pickConcepts: (batchId: string, pick: { picks: { ideaId: string; ownerSaid: string }[] }) =>
    request<{ state: string; warnings?: string[] }>(`/api/batches/${encodeURIComponent(batchId)}/concept-pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pick),
    }),
  done: (batchId: string) => request<DoneReport>(`/api/batches/${encodeURIComponent(batchId)}/done`),
  calibration: () => request<CalibrationPage>("/api/calibration"),
  packs: async () => (await request<{ packs: PackSummary[] }>("/api/packs")).packs,
  /** A client's pack, by the token of its private link. It needs no sign-in. */
  pack: (token: string) => request<PackView>(`/api/pack/${encodeURIComponent(token)}`),
  /** Every pack of one client, by the token of the client's private link. It needs no sign-in. */
  client: (token: string) => request<ClientView>(`/api/client/${encodeURIComponent(token)}`),
  /** An address that downloads one ad, made at the click and good for a few minutes. */
  packDownload: async (door: string, ad: number, format: PackFormat) => (await request<{ url: string }>(`${door}/download/${ad}?format=${format}`)).url,
  packComment: async (door: string, comment: { text: string; adName?: string; change?: ChangeKind }) => (await send<{ comment: ShownComment & { at: string } }>(`${door}/comments`, comment)).comment,
  /**
   * Sends one results file: the studio signs an address for this file, the file goes straight to the store,
   * and the studio then reads it and says whether it kept it.
   */
  sendResult: async (door: string, file: File, type: string) => {
    const { putUrl, upload } = await send<{ putUrl: string; upload: { id: string } }>(`${door}/uploads`, { name: file.name, type, bytes: file.size });
    const sent = await fetch(putUrl, { method: "PUT", headers: { "content-type": type }, body: file, referrerPolicy: "no-referrer" });
    if (!sent.ok) throw new ApiError(sent.status, "upload_failed", "The file did not arrive. Try again in a moment.");
    const { state } = await send<{ state: "checked" | "refused" | "waiting" }>(`${door}/uploads/${encodeURIComponent(upload.id)}/done`, {});
    if (state === "refused") throw new ApiError(400, "refused", "This file is not the picture or the CSV its name says. Send a JPEG or PNG screenshot, or a CSV export.");
  },
  /** The owner's page of clients: each brand with its link, its packs, and what its client wrote and sent. */
  portal: async () => (await request<{ clients: OwnerClient[] }>("/api/portal")).clients,
  /** Makes, replaces or turns off a client's link. A new link is in the answer once. */
  clientLink: (brandId: string, action: "make" | "replace" | "off") => send<{ url?: string; link?: ClientLink }>(`/api/portal/${encodeURIComponent(brandId)}/link`, { action }),
  markComment: async (packId: string, id: string, mark: { hidden: boolean } | { status: ChangeStatus }) =>
    (await send<{ comment: PackComment }>(`/api/packs/${encodeURIComponent(packId)}/comments/${encodeURIComponent(id)}`, mark)).comment,
  /** A client's CSV as a table of text. */
  uploadTable: (packId: string, id: string) => request<UploadTable>(`/api/packs/${encodeURIComponent(packId)}/uploads/${encodeURIComponent(id)}/table`),
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
