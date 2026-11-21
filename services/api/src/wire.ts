import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Deps } from "./app.js";
import { ClientApprovals } from "./auth/clients.js";
import { UserPoolClients } from "./auth/cognito-clients.js";
import { createDashboardSignIn } from "./auth/oauth.js";
import { createAccessTokenVerifier } from "./auth/token.js";
import { buildConfig, type Config } from "./config.js";
import { PROMPTS } from "./mcp/prompts.js";
import { ToolRegistry } from "./mcp/registry.js";
import { McpServer } from "./mcp/server.js";
import { coreTools } from "./mcp/tools/core.js";
import { DynamoTable } from "./store/table.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

async function loadConfig(): Promise<Config> {
  const result = await new SSMClient({}).send(new GetParameterCommand({ Name: env("CONFIG_PARAMETER") }));
  return buildConfig(JSON.parse(result.Parameter?.Value ?? "null"), process.env.BUILD_ID ?? "dev");
}

export interface Wired {
  config: Config;
  cognito: UserPoolClients;
  approvals: ClientApprovals;
  table: DynamoTable;
}

/** Connects the real AWS services. Runs once for each function instance. */
export async function wire(): Promise<Wired> {
  const config = await loadConfig();
  const table = new DynamoTable(new DynamoDBClient({}), env("TABLE_NAME"));
  const cognito = new UserPoolClients(new CognitoIdentityProviderClient({}), config.userPoolId);
  const approvals = new ClientApprovals(table, cognito, config.dashboardClientId);
  return { config, cognito, approvals, table };
}

export function appDeps({ config, table, approvals }: Wired): Deps {
  return {
    config,
    table,
    approvals,
    tokens: createAccessTokenVerifier(config),
    signIn: createDashboardSignIn(config),
    mcp: new McpServer({
      name: "a11-wild",
      version: config.buildId,
      registry: new ToolRegistry(coreTools(config)),
      prompts: PROMPTS,
    }),
    now: () => new Date(),
  };
}
