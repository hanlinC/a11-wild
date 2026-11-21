import { z } from "zod";
import type { Role } from "@a11-wild/shared";
import { RULES_VERSION } from "../houserules.js";

export interface ToolContext {
  user: { sub: string; email: string; role: Role };
  clientId: string;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: Shape;
  /** The tool changes stored data. */
  writes?: boolean;
  /** The tool can spend money. Only the owner may call it. */
  paid?: boolean;
  /** The caller must pass the current house-rules version, which proves it read the rules. */
  needsRules?: boolean;
  handler: (args: z.infer<z.ZodObject<Shape>>, context: ToolContext) => Promise<unknown> | unknown;
}

export function defineTool<Shape extends z.ZodRawShape>(tool: ToolDefinition<Shape>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

/** A step the studio refuses on purpose. Its message goes to the agent as the tool's error. */
export class Refusal extends Error {}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
}

const RULES_FIELD = {
  rulesVersion: z.string().describe("The version that rules_get returned. It proves you read the house rules."),
};

function inputSchema(tool: ToolDefinition): z.ZodObject {
  return z.strictObject(tool.needsRules ? { ...tool.input, ...RULES_FIELD } : tool.input);
}

function failure(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(tools: readonly ToolDefinition[]) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    if (this.tools.size !== tools.length) throw new Error("Two tools share one name.");
  }

  /** The published list: each tool with the JSON Schema of the exact input it accepts. */
  list() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(inputSchema(tool)),
      annotations: { readOnlyHint: !tool.writes && !tool.paid },
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async call(name: string, rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return failure(`There is no tool named "${name}".`);
    if (tool.paid && context.user.role !== "owner") {
      return failure(`Only the owner can call ${name}, because it can spend money.`);
    }

    // Checked before the rest of the input, so that a caller who skipped the rules learns that first.
    const sentVersion = (rawArgs as { rulesVersion?: unknown } | null | undefined)?.rulesVersion;
    if (tool.needsRules && sentVersion !== RULES_VERSION) {
      return failure(
        `The house rules are at version ${RULES_VERSION}. Call rules_get, read the rules, and send that version as rulesVersion.`,
      );
    }

    const parsed = inputSchema(tool).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
      return failure(`Invalid input for ${name}. ${problems.join("; ")}`);
    }
    const { rulesVersion: _rulesVersion, ...args } = parsed.data as Record<string, unknown>;

    let result: unknown;
    try {
      result = await tool.handler(args, context);
    } catch (error) {
      // A refusal the studio made on purpose carries a message written for the agent.
      if (error instanceof Refusal) return failure(error.message);
      throw error;
    }
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] };
  }
}
