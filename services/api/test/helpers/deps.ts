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
import { createSession, SESSION_COOKIE } from "../../src/auth/session.js";
import { studioTools } from "../../src/mcp/tools/index.js";
import type { WaitingClient } from "../../src/notify.js";
import type { Net } from "../../src/urlsafety.js";
import { fakeNet } from "./net.js";
import { fakeFal } from "./fal.js";
import { fakeParallel, type ParallelCall, testKeys } from "./parallel.js";
import { MemoryPictures } from "./pictures.js";
import { fakePixels } from "./pixels.js";
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
export interface StudioOptions {
  /** The pages and pictures the studio can fetch. */
  net?: Net;
  /** What Parallel answers. */
  parallel?: Parameters<typeof fakeParallel>[0];
  /** What fal answers. With none, every render is taken and is done at its first read. */
  fal?: Parameters<typeof fakeFal>[0];
  /** What the pixel function answers. With none, every picture tool makes a picture and every check passes. */
  pixels?: Parameters<typeof fakePixels>[1];
}

export async function createStudio(options: StudioOptions = {}) {
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

  const notices: WaitingClient[] = [];
  const notifier = {
    fails: false,
    async clientWaiting(client: WaitingClient) {
      if (this.fails) throw new Error("topic is down");
      notices.push(client);
    },
  };
  const approvals = new ClientApprovals(table, cognito, config.dashboardClientId, now, notifier);
  const pictures = new MemoryPictures();
  const parallel = fakeParallel(options.parallel ?? ((_call: ParallelCall) => ({ status: 500 })));
  const fal = fakeFal(options.fal);
  const pixels = fakePixels(pictures, options.pixels);
  const { tools, services } = studioTools({
    config,
    table,
    now,
    keys: testKeys,
    pictures,
    net: options.net ?? fakeNet({}),
    parallelFetch: parallel.fetchFn,
    falFetch: fal.fetchFn,
    pixelRunner: pixels.runner,
  });
  const spend = { ledger: services.ledger, gate: services.gate };
  const deps: Deps = {
    config,
    table,
    approvals,
    tokens: createAccessTokenVerifier(config, signer.jwks),
    signIn: createDashboardSignIn(config, fetchFn, signer.jwks),
    mcp: new McpServer({
      name: "a11-wild",
      version: config.buildId,
      registry: new ToolRegistry([...tools, ...sampleTools]),
      prompts: PROMPTS,
    }),
    studio: services,
    pictures,
    now,
  };

  return {
    app: createApp(deps),
    deps,
    table,
    cognito,
    signer,
    clock,
    approvals,
    notices,
    notifier,
    spend,
    services,
    pictures,
    parallelCalls: parallel.calls,
    fal,
    pixels,
    tokenRequests,
    tokenEndpoint,
  };
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

/** Calls one tool as an approved client. Returns the tool's reply parsed, or its error text. */
export async function callTool(studio: Studio, name: string, args: unknown = {}, as: { sub?: string } = {}) {
  const token = await studio.signer.accessToken(config, as.sub ? { sub: as.sub } : {});
  const response = await studio.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = await json(response);
  const text = result.content[0].text as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result.isError === true ? { ok: false as const, error: text } : { ok: true as const, value: JSON.parse(text) as any };
}

/** The cookie of a signed-in dashboard session. */
export async function sessionCookie(studio: Studio, role: "owner" | "member" = "owner"): Promise<string> {
  const user = { sub: `sub-${role}`, email: `${role}@example.com`, role, disabled: false };
  return `${SESSION_COOKIE}=${await createSession(studio.table, config, user, studio.clock.now)}`;
}
