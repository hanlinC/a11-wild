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
