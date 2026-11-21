/** Types that cross the wire between the API and the dashboard. */

export type Role = "owner" | "member";

export interface Me {
  email: string;
  role: Role;
}

export type ClientStatus = "pending" | "approved" | "revoked";

/** An MCP client (an AI agent's connection) as the Connections page shows it. */
export interface ClientRecord {
  clientId: string;
  name: string;
  callbackUrls: string[];
  status: ClientStatus;
  firstSeenAt: string;
  firstSeenBy: string;
  decidedAt?: string;
}

export interface StudioStatus {
  buildId: string;
  rulesVersion: string;
}

export type SpendService = "parallel" | "fal";

/** One paid call in the ledger. `reserved` means the outcome is not known, so it still counts. */
export interface SpendLine {
  at: string;
  service: SpendService;
  kind: string;
  ref: string;
  batchId?: string;
  usd: number;
  status: "reserved" | "spent" | "released";
}

export interface SpendSummary {
  /** The calendar month, in UTC, as YYYY-MM. */
  month: string;
  monthUsd: number;
  monthCapUsd: number;
  batchCapUsd: number;
  batchId?: string;
  batchUsd?: number;
  lines: SpendLine[];
}
