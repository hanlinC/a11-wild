import {
  type CognitoIdentityProviderClient,
  DeleteUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  ListUserPoolClientsCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import type { CognitoClientInfo, CognitoClients } from "./clients.js";

export class UserPoolClients implements CognitoClients {
  constructor(
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
  ) {}

  async describe(clientId: string): Promise<CognitoClientInfo | undefined> {
    try {
      const result = await this.cognito.send(
        new DescribeUserPoolClientCommand({ UserPoolId: this.userPoolId, ClientId: clientId }),
      );
      const client = result.UserPoolClient;
      if (!client || client.ClientType !== "DCR") return undefined;
      return {
        clientId,
        name: client.ClientName ?? "",
        callbackUrls: client.CallbackURLs ?? [],
        createdAt: client.CreationDate ?? new Date(0),
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return undefined;
      throw error;
    }
  }

  async delete(clientId: string): Promise<void> {
    try {
      await this.cognito.send(new DeleteUserPoolClientCommand({ UserPoolId: this.userPoolId, ClientId: clientId }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }

  async listRegistered(): Promise<CognitoClientInfo[]> {
    const clients: CognitoClientInfo[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.cognito.send(
        new ListUserPoolClientsCommand({
          UserPoolId: this.userPoolId,
          ClientType: "DCR",
          MaxResults: 60,
          NextToken: nextToken,
        }),
      );
      for (const entry of page.UserPoolClients ?? []) {
        if (!entry.ClientId) continue;
        const info = await this.describe(entry.ClientId);
        if (info) clients.push(info);
      }
      nextToken = page.NextToken;
    } while (nextToken);
    return clients;
  }
}
