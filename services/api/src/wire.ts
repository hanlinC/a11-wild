import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
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
import { studioTools } from "./mcp/tools/index.js";
import { type Pictures, S3Pictures } from "./pictures/store.js";
import { ParameterKeys, type ProviderKeys } from "./secrets.js";
import { DynamoTable } from "./store/table.js";
import { realNet } from "./urlsafety.js";

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
  keys: ProviderKeys;
  pictures: Pictures;
}

/** Connects the real AWS services. Runs once for each function instance. */
export async function wire(): Promise<Wired> {
  const config = await loadConfig();
  const table = new DynamoTable(new DynamoDBClient({}), env("TABLE_NAME"));
  const cognito = new UserPoolClients(new CognitoIdentityProviderClient({}), config.userPoolId);
  const approvals = new ClientApprovals(table, cognito, config.dashboardClientId);
  const keys = new ParameterKeys(new SSMClient({}), env("KEYS_PREFIX"));
  const pictures = new S3Pictures(new S3Client({}), env("PICTURES_BUCKET"));
  return { config, cognito, approvals, table, keys, pictures };
}

export function appDeps({ config, table, approvals, keys, pictures }: Wired): Deps {
  const now = () => new Date();
  const { tools, services } = studioTools({ config, table, now, keys, pictures, net: realNet });
  return {
    config,
    table,
    approvals,
    tokens: createAccessTokenVerifier(config),
    signIn: createDashboardSignIn(config),
    mcp: new McpServer({
      name: "a11-wild",
      version: config.buildId,
      registry: new ToolRegistry(tools),
      prompts: PROMPTS,
    }),
    studio: services,
    pictures,
    now,
  };
}
