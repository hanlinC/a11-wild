import { beforeEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "../../src/houserules.js";
import { approvedClient, config, createStudio, json, type Studio } from "../helpers/deps.js";

let studio: Studio;
let ownerToken: string;
let memberToken: string;

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  ownerToken = await studio.signer.accessToken(config);
  memberToken = await studio.signer.accessToken(config, { sub: "sub-member" });
});

async function send(body: unknown, token = ownerToken) {
  const response = await studio.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 202 ? undefined : await json(response) };
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });
const callTool = (name: string, args?: unknown, token?: string) =>
  send(rpc("tools/call", { name, arguments: args }), token).then((reply) => reply.body.result);

describe("MCP server", () => {
  it("answers initialize with the client's protocol version and its capabilities", async () => {
    const { body } = await send(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} }));
    expect(body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "a11-wild", version: "test-build" },
    });
  });

  it("answers an unknown protocol version with its newest one", async () => {
    const { body } = await send(rpc("initialize", { protocolVersion: "1999-01-01" }));
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists each tool with the JSON Schema of the input it accepts", async () => {
    const { body } = await send(rpc("tools/list"));
    const tools = Object.fromEntries(body.result.tools.map((tool: { name: string }) => [tool.name, tool]));
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["rules_get", "whoami", "studio_status"]));
    expect(tools.rules_get.inputSchema).toMatchObject({
      type: "object",
      required: ["role", "kind"],
      properties: { role: { enum: ["main", "writer", "art_director", "critic"] }, kind: { enum: ["v1", "v2", "v3"] } },
    });
    expect(tools.sample_write.inputSchema.required).toEqual(expect.arrayContaining(["title", "rulesVersion"]));
  });

  it("returns the house rules and their version for a role", async () => {
    const result = await callTool("rules_get", { role: "critic", kind: "v1" });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.rulesVersion).toBe(RULES_VERSION);
    expect(payload.rules.map((rule: { id: string }) => rule.id)).toContain("blind-critic");
    expect(payload.rules.map((rule: { id: string }) => rule.id)).not.toContain("spend");
  });

  it("tells the caller who is signed in", async () => {
    const result = await callTool("whoami", {}, memberToken);
    expect(JSON.parse(result.content[0].text)).toEqual({ email: "member@example.com", role: "member" });
  });

  it("refuses an argument of the wrong type, names the field and runs nothing", async () => {
    const result = await callTool("rules_get", { role: 7, kind: "v1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("role");
  });

  it("refuses an argument the tool does not know", async () => {
    const result = await callTool("whoami", { extra: true });
    expect(result.isError).toBe(true);
  });

  it("refuses a creative write without the current rules version and points to rules_get", async () => {
    for (const args of [{ title: "idea" }, { title: "idea", rulesVersion: "old" }]) {
      const result = await callTool("sample_write", args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("rules_get");
    }
  });

  it("runs a creative write that carries the current rules version", async () => {
    const result = await callTool("sample_write", { title: "idea", rulesVersion: RULES_VERSION });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ saved: "idea" });
  });

  it("lets only the owner call a tool that can spend money", async () => {
    expect((await callTool("sample_paid", {}, memberToken)).isError).toBe(true);
    expect((await callTool("sample_paid", {}, ownerToken)).content[0].text).toBe("spent");
  });

  it("serves the pipeline as the prompt wild_ads, and its first step asks for brand and product", async () => {
    const list = await send(rpc("prompts/list"));
    expect(list.body.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual(["outreach", "concept_ads", "headline_ads", "wild_ads"]);

    const { body } = await send(rpc("prompts/get", { name: "wild_ads" }));
    const text: string = body.result.messages[0].content.text;
    expect(text.indexOf("Step 0. Ask first")).toBeGreaterThan(-1);
    expect(text.indexOf("which brand")).toBeLessThan(text.indexOf("Step 1."));
    expect(text.indexOf("which product")).toBeLessThan(text.indexOf("Step 1."));
  });

  it("answers an unknown method, an unknown tool and an unknown prompt with JSON-RPC errors", async () => {
    expect((await send(rpc("resources/list"))).body.error.code).toBe(-32601);
    expect((await send(rpc("tools/call", { name: "nope" }))).body.error.code).toBe(-32602);
    expect((await send(rpc("prompts/get", { name: "nope" }))).body.error.code).toBe(-32602);
  });

  it("answers a batch of two requests with two replies in order", async () => {
    const { body } = await send([rpc("ping", undefined, "a"), rpc("tools/list", undefined, "b")]);
    expect(body.map((reply: { id: string }) => reply.id)).toEqual(["a", "b"]);
  });

  it("answers a notification with 202 and no body", async () => {
    const reply = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(reply.status).toBe(202);
  });

  it("answers a body that is not JSON, and a message that is not JSON-RPC", async () => {
    const broken = await send("{not json");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe(-32700);
    expect((await send({ hello: "world" })).body.error.code).toBe(-32600);
  });
});
