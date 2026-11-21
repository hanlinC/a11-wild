import { checkCodesFor } from "../../checks/codes.js";
import { z } from "zod";
import { BATCH_KINDS, type StudioStatus } from "@a11-wild/shared";
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
        role: z.enum(RULE_ROLES).describe('"main" for the agent that runs the batch, "writer" for a helper that writes the ideas and the words, "art_director" for a helper that makes and checks the pictures, "critic" for the blind critic.'),
        kind: z.enum(BATCH_KINDS).describe("The kind of ad the batch makes: v1, v2 or v3. The owner names it."),
      },
      handler: ({ role, kind }) => ({ rulesVersion: RULES_VERSION, role, kind, rules: rulesFor(role, kind), pictureChecks: checkCodesFor(kind) }),
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
