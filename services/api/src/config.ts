import { z } from "zod";

/** Values that exist only after the stack is deployed. Stored as one JSON parameter. */
const RuntimeConfigSchema = z.object({
  publicOrigin: z.url().refine((value) => value.startsWith("https://") && !value.endsWith("/")),
  region: z.string().min(1),
  userPoolId: z.string().min(1),
  cognitoDomain: z.url().refine((value) => value.startsWith("https://") && !value.endsWith("/")),
  dashboardClientId: z.string().min(1),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export interface Config extends RuntimeConfig {
  buildId: string;
  /** Token issuer of the user pool. */
  issuer: string;
  /** The MCP endpoint. Access tokens must be bound to it. */
  mcpResource: string;
  /** The one custom scope an MCP token must carry. */
  mcpScope: string;
  sessionSeconds: number;
}

export const MCP_SCOPE_NAME = "studio";
export const SESSION_SECONDS = 12 * 60 * 60;

export function buildConfig(runtime: unknown, buildId: string): Config {
  const parsed = RuntimeConfigSchema.parse(runtime);
  const mcpResource = `${parsed.publicOrigin}/mcp`;
  return {
    ...parsed,
    buildId,
    issuer: `https://cognito-idp.${parsed.region}.amazonaws.com/${parsed.userPoolId}`,
    mcpResource,
    mcpScope: `${mcpResource}/${MCP_SCOPE_NAME}`,
    sessionSeconds: SESSION_SECONDS,
  };
}
