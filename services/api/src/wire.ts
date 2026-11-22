import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
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
import { type Notifier, SnsNotifier } from "./notify.js";
import { type Pictures, S3Pictures } from "./pictures/store.js";
import { LambdaPixelRunner, type PixelRunner } from "./pixels/runner.js";
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

export interface WiredClients {
  config: Config;
  cognito: UserPoolClients;
  approvals: ClientApprovals;
  table: DynamoTable;
  notifier?: Notifier;
}

export interface Wired extends WiredClients {
  keys: ProviderKeys;
  pictures: Pictures;
  pixelRunner?: PixelRunner;
}

/** The clients and their approvals. The daily clean-up needs these only, and it has no key and no picture to read. */
export async function wireClients(): Promise<WiredClients> {
  const config = await loadConfig();
  const table = new DynamoTable(new DynamoDBClient({}), env("TABLE_NAME"));
  const cognito = new UserPoolClients(new CognitoIdentityProviderClient({}), config.userPoolId);
  // Only the API function has the topic: the daily clean-up meets no new client.
  const topic = process.env.OWNER_TOPIC_ARN;
  const notifier = topic ? new SnsNotifier(new SNSClient({}), topic, config.publicOrigin) : undefined;
  const approvals = new ClientApprovals(table, cognito, config.dashboardClientId, () => new Date(), notifier);
  return { config, cognito, approvals, table, ...(notifier ? { notifier } : {}) };
}

/** Connects the real AWS services for the API. Runs once for each function instance. */
export async function wire(): Promise<Wired> {
  const clients = await wireClients();
  const keys = new ParameterKeys(new SSMClient({}), env("KEYS_PREFIX"));
  const pictures = new S3Pictures(new S3Client({}), env("PICTURES_BUCKET"));
  const pixelFunction = process.env.PIXELS_FUNCTION;
  return { ...clients, keys, pictures, ...(pixelFunction ? { pixelRunner: new LambdaPixelRunner(new LambdaClient({}), pixelFunction) } : {}) };
}

export function appDeps({ config, table, approvals, keys, pictures, pixelRunner, notifier }: Wired): Deps {
  const now = () => new Date();
  const { tools, services } = studioTools({ config, table, now, keys, pictures, net: realNet, ...(pixelRunner ? { pixelRunner } : {}), ...(notifier ? { notifier } : {}) });
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
