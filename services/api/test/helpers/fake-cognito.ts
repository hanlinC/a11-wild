import type { CognitoClientInfo, CognitoClients } from "../../src/auth/clients.js";

/** A user pool's self-registered app clients, held in memory. */
export class FakeCognito implements CognitoClients {
  readonly clients = new Map<string, CognitoClientInfo>();

  register(clientId: string, overrides: Partial<CognitoClientInfo> = {}): void {
    this.clients.set(clientId, {
      clientId,
      name: `client ${clientId}`,
      callbackUrls: ["http://localhost/callback"],
      createdAt: new Date("2026-11-21T00:00:00Z"),
      ...overrides,
    });
  }

  async describe(clientId: string): Promise<CognitoClientInfo | undefined> {
    return this.clients.get(clientId);
  }

  async delete(clientId: string): Promise<void> {
    this.clients.delete(clientId);
  }

  async listRegistered(): Promise<CognitoClientInfo[]> {
    return [...this.clients.values()];
  }
}
