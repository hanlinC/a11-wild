import { CHECK_CODES } from "../../checks/codes.js";
import { z } from "zod";
import type { StudioStatus } from "@a11-wild/shared";
import type { Config } from "../../config.js";
import { RULE_ROLES, RULES_VERSION, rulesFor } from "../../houserules.js";
import { defineTool, type ToolDefinition } from "../registry.js";

export function coreTools(config: Config): ToolDefinition[] {
  return [
    defineTool({
      name: "rules_get",
      description:
        "FIRST, before any creative step: read the owner's house rules for your role. Free. Returns the rules, their version, and the picture checks D1 to D11 and F1 to F8; tools that write creative work need that version as rulesVersion.",
      input: {
        role: z.enum(RULE_ROLES).describe('"main" for the agent that runs the batch, "critic" for the blind critic.'),
      },
      handler: ({ role }) => ({ rulesVersion: RULES_VERSION, role, rules: rulesFor(role), pictureChecks: CHECK_CODES }),
    }),
    defineTool({
      name: "whoami",
      description: "Who you are signed in as, and whether you can approve spend. Free.",
      input: {},
      handler: (_args, context) => ({ email: context.user.email, role: context.user.role }),
    }),
    defineTool({
      name: "studio_status",
      description: "The studio's build and house-rules version. Free. Use it to check the connection.",
      input: {},
      handler: (): StudioStatus => ({ buildId: config.buildId, rulesVersion: RULES_VERSION }),
    }),
  ];
}
