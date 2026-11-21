import { z } from "zod";
import type { Deps } from "../../src/app.js";
import { createApp } from "../../src/app.js";
import { ClientApprovals } from "../../src/auth/clients.js";
import { createDashboardSignIn } from "../../src/auth/oauth.js";
import { createAccessTokenVerifier } from "../../src/auth/token.js";
import { userItem } from "../../src/auth/users.js";
import { buildConfig } from "../../src/config.js";
import { PROMPTS } from "../../src/mcp/prompts.js";
import { defineTool, ToolRegistry } from "../../src/mcp/registry.js";
import { McpServer } from "../../src/mcp/server.js";
import { coreTools } from "../../src/mcp/tools/core.js";
import { FakeCognito } from "./fake-cognito.js";
import { MemoryTable } from "./memory-table.js";
import { createSigner } from "./tokens.js";

export const ORIGIN = "https://studio.example.com";

export const config = buildConfig(
  {
    publicOrigin: ORIGIN,
    region: "us-east-1",
    userPoolId: "us-east-1" + "_TESTPOOL1",
    cognitoDomain: "https://login.example.com",
    dashboardClientId: "dashboard-client",
  },
  "test-build",
);

/** Two tools that stand in for later creative and paid tools. */
const sampleTools = [
  defineTool({
    name: "sample_write",
    description: "A creative write that needs the house rules.",
    input: { title: z.string().min(1) },
    writes: true,
    needsRules: true,
    handler: ({ title }) => ({ saved: title }),
  }),
  defineTool({
    name: "sample_paid",
    description: "A call that can spend money.",
    input: {},
    paid: true,
    handler: () => "spent",
  }),
];

/** A whole studio in memory: one owner, one member, and a clock the test controls. */
export async function createStudio() {
  const table = new MemoryTable();
  const cognito = new FakeCognito();
  const signer = await createSigner();
  const clock = { now: new Date("2026-11-21T12:00:00Z") };
  const now = () => clock.now;
  const tokenRequests: URLSearchParams[] = [];
  const tokenEndpoint = { idToken: undefined as string | undefined };

  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    tokenRequests.push(new URLSearchParams(String(init?.body)));
    if (!tokenEndpoint.idToken) return new Response("{}", { status: 400 });
    return Response.json({ id_token: tokenEndpoint.idToken });
  }) as typeof fetch;

  await table.put(userItem({ sub: "sub-owner", email: "owner@example.com", role: "owner" }));
  await table.put(userItem({ sub: "sub-member", email: "member@example.com", role: "member" }));

  const approvals = new ClientApprovals(table, cognito, config.dashboardClientId, now);
  const deps: Deps = {
    config,
    table,
    approvals,
    tokens: createAccessTokenVerifier(config, signer.jwks),
    signIn: createDashboardSignIn(config, fetchFn, signer.jwks),
    mcp: new McpServer({
      name: "a11-wild",
      version: config.buildId,
      registry: new ToolRegistry([...coreTools(config), ...sampleTools]),
      prompts: PROMPTS,
    }),
    now,
  };

  return { app: createApp(deps), deps, table, cognito, signer, clock, approvals, tokenRequests, tokenEndpoint };
}

export type Studio = Awaited<ReturnType<typeof createStudio>>;

/** Registers a client in the fake user pool and marks it approved. */
export async function approvedClient(studio: Studio, clientId = "client-1"): Promise<void> {
  studio.cognito.register(clientId);
  await studio.approvals.statusOf(clientId, "owner@example.com");
  await studio.approvals.approve(clientId);
}

/** A response body for assertions. Tests read fields the type system cannot know. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json(response: Response): Promise<any> {
  return response.json();
}
