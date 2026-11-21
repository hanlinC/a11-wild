import type { ClientRecord, ClientStatus } from "@a11-wild/shared";
import type { Item, Table } from "../store/table.js";

const PK = "CLIENT";

export interface CognitoClientInfo {
  clientId: string;
  name: string;
  callbackUrls: string[];
  createdAt: Date;
}

/** The app clients that MCP clients registered for themselves in the user pool. */
export interface CognitoClients {
  describe(clientId: string): Promise<CognitoClientInfo | undefined>;
  delete(clientId: string): Promise<void>;
  listRegistered(): Promise<CognitoClientInfo[]>;
}

type ClientItem = Item & Omit<ClientRecord, "clientId">;

function toRecord(item: ClientItem): ClientRecord {
  return {
    clientId: item.sk,
    name: item.name,
    callbackUrls: item.callbackUrls,
    status: item.status,
    firstSeenAt: item.firstSeenAt,
    firstSeenBy: item.firstSeenBy,
    ...(item.decidedAt ? { decidedAt: item.decidedAt } : {}),
  };
}

/**
 * The user pool shows no consent screen, so the studio keeps its own list:
 * a client works only after the owner approved it.
 */
export class ClientApprovals {
  constructor(
    private readonly table: Table,
    private readonly cognito: CognitoClients,
    private readonly dashboardClientId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The status of a client that presented a valid token. A client seen for the
   * first time is stored as pending. "unknown" means the user pool has no such
   * registered client, or it is the dashboard's own client.
   */
  async statusOf(clientId: string, seenBy: string): Promise<ClientStatus | "unknown"> {
    if (clientId === this.dashboardClientId) return "unknown";
    const existing = await this.table.get<ClientItem>(PK, clientId);
    if (existing) return existing.status;

    const info = await this.cognito.describe(clientId);
    if (!info) return "unknown";
    await this.table.put(
      {
        pk: PK,
        sk: clientId,
        name: info.name,
        callbackUrls: info.callbackUrls,
        status: "pending",
        firstSeenAt: this.now().toISOString(),
        firstSeenBy: seenBy,
      } satisfies ClientItem,
      { ifNotExists: true },
    );
    return (await this.table.get<ClientItem>(PK, clientId))?.status ?? "pending";
  }

  async list(): Promise<ClientRecord[]> {
    const items = await this.table.query<ClientItem>(PK);
    return items.map(toRecord).sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  }

  async get(clientId: string): Promise<ClientRecord | undefined> {
    const item = await this.table.get<ClientItem>(PK, clientId);
    return item ? toRecord(item) : undefined;
  }

  async approve(clientId: string): Promise<ClientRecord | undefined> {
    return this.decide(clientId, "approved");
  }

  /** Marks the client revoked and deletes its app client, so it cannot get new tokens. */
  async revoke(clientId: string): Promise<ClientRecord | undefined> {
    const record = await this.decide(clientId, "revoked");
    if (record) await this.cognito.delete(clientId);
    return record;
  }

  /**
   * Forgets a client only while it still waits for approval. Returns false when
   * the owner decided in the meantime, so the caller must leave the client alone.
   */
  async forgetIfPending(clientId: string): Promise<boolean> {
    return this.table.delete(PK, clientId, { ifEquals: { attribute: "status", value: "pending" } });
  }

  private async decide(clientId: string, status: ClientStatus): Promise<ClientRecord | undefined> {
    const item = await this.table.get<ClientItem>(PK, clientId);
    if (!item) return undefined;
    const next: ClientItem = { ...item, status, decidedAt: this.now().toISOString() };
    await this.table.put(next);
    return toRecord(next);
  }
}
