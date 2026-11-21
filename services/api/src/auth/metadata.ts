import type { Config } from "../config.js";

/** Where an MCP client finds out which authorization server protects this server (RFC 9728). */
export function resourceMetadataUrl(config: Config): string {
  return `${config.publicOrigin}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(config: Config) {
  return {
    resource: config.mcpResource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.mcpScope],
    bearer_methods_supported: ["header"],
    resource_name: "a11-wild studio",
  };
}

/** The `WWW-Authenticate` value that sends an MCP client to the metadata above. */
export function challenge(config: Config, error?: "invalid_token" | "insufficient_scope"): string {
  const parts = [`resource_metadata="${resourceMetadataUrl(config)}"`, `scope="${config.mcpScope}"`];
  if (error) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}
