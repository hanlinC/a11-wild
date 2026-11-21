import { log } from "../log.js";
import type { Prompt } from "./prompts.js";
import type { ToolContext, ToolRegistry } from "./registry.js";

/** Newest first. The server answers with the client's version when it knows it. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type Id = string | number | null;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: unknown;
}

type RpcResponse =
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

export function rpcError(id: Id, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const { jsonrpc, method, id } = value as Record<string, unknown>;
  const idOk = id === undefined || id === null || typeof id === "string" || typeof id === "number";
  return jsonrpc === "2.0" && typeof method === "string" && idOk;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export interface McpServerOptions {
  name: string;
  version: string;
  registry: ToolRegistry;
  prompts: readonly Prompt[];
}

/**
 * A stateless MCP server: every POST carries all it needs and gets a JSON
 * reply, so any number of function instances can answer.
 */
export class McpServer {
  constructor(private readonly options: McpServerOptions) {}

  /** Returns `undefined` when nothing in the body expects a reply (HTTP 202). */
  async handle(body: unknown, context: ToolContext): Promise<RpcResponse | RpcResponse[] | undefined> {
    if (Array.isArray(body)) {
      if (body.length === 0) return rpcError(null, INVALID_REQUEST, "Empty batch.");
      const replies: RpcResponse[] = [];
      for (const entry of body) {
        const reply = await this.handleOne(entry, context);
        if (reply) replies.push(reply);
      }
      return replies.length > 0 ? replies : undefined;
    }
    return this.handleOne(body, context);
  }

  private async handleOne(message: unknown, context: ToolContext): Promise<RpcResponse | undefined> {
    if (!isRequest(message)) return rpcError(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.");
    const isNotification = message.id === undefined;
    const id = message.id ?? null;
    try {
      const result = await this.dispatch(message, context);
      if (isNotification) return undefined;
      return "error" in result ? rpcError(id, result.error.code, result.error.message) : { jsonrpc: "2.0", id, result: result.value };
    } catch (error) {
      log.error("mcp_method_failed", { method: message.method, name: error instanceof Error ? error.name : "unknown" });
      return isNotification ? undefined : rpcError(id, INTERNAL_ERROR, "The server could not finish this request.");
    }
  }

  private async dispatch(
    message: RpcRequest,
    context: ToolContext,
  ): Promise<{ value: unknown } | { error: { code: number; message: string } }> {
    const params = asRecord(message.params);
    switch (message.method) {
      case "initialize": {
        const requested = params.protocolVersion;
        const known = PROTOCOL_VERSIONS.find((version) => version === requested);
        return {
          value: {
            protocolVersion: known ?? PROTOCOL_VERSIONS[0],
            capabilities: { tools: {}, prompts: {} },
            serverInfo: { name: this.options.name, version: this.options.version },
            instructions:
              "Call rules_get first. The prompt wild_ads holds the pipeline. The server makes every research and image call itself; you need no other connection.",
          },
        };
      }
      case "ping":
        return { value: {} };
      case "tools/list":
        return { value: { tools: this.options.registry.list() } };
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string") return { error: { code: INVALID_PARAMS, message: "tools/call needs a tool name." } };
        if (!this.options.registry.has(name)) {
          return { error: { code: INVALID_PARAMS, message: `There is no tool named "${name}".` } };
        }
        const result = await this.options.registry.call(name, params.arguments, context);
        log.info("tool_called", {
          tool: name,
          user: context.user.sub,
          client: context.clientId,
          outcome: result.isError ? "refused" : "ok",
        });
        return { value: result };
      }
      case "prompts/list":
        return {
          value: {
            prompts: this.options.prompts.map(({ name, title, description }) => ({ name, title, description })),
          },
        };
      case "prompts/get": {
        const prompt = this.options.prompts.find((entry) => entry.name === params.name);
        if (!prompt) return { error: { code: INVALID_PARAMS, message: "There is no prompt with that name." } };
        return {
          value: {
            description: prompt.description,
            messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
          },
        };
      }
      default:
        if (message.method.startsWith("notifications/")) return { value: {} };
        return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` } };
    }
  }
}

export const RPC_CODES = { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR };
