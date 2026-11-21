import { JwtVerifier } from "aws-jwt-verify";
import type { Jwks } from "aws-jwt-verify/jwk";
import type { Config } from "../config.js";

export interface AccessClaims {
  sub: string;
  clientId: string;
}

export type TokenResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; status: 401; error: "invalid_token" }
  | { ok: false; status: 403; error: "insufficient_scope" };

export interface AccessTokenVerifier {
  verify(token: string): Promise<TokenResult>;
}

/**
 * Checks an MCP access token: signature, issuer, expiry, that it is an access
 * token, that it is bound to this server's MCP endpoint, and that it carries
 * the studio scope. `jwks` is for tests; in production the keys are fetched
 * from the user pool and cached.
 */
export function createAccessTokenVerifier(config: Config, jwks?: Jwks): AccessTokenVerifier {
  const verifier = JwtVerifier.create({
    issuer: config.issuer,
    audience: config.mcpResource,
    jwksUri: `${config.issuer}/.well-known/jwks.json`,
  });
  if (jwks) verifier.cacheJwks(jwks);

  return {
    async verify(token) {
      let payload;
      try {
        payload = await verifier.verify(token);
      } catch {
        return { ok: false, status: 401, error: "invalid_token" };
      }
      const { sub, client_id: clientId, token_use: tokenUse, scope } = payload;
      if (tokenUse !== "access" || typeof sub !== "string" || typeof clientId !== "string") {
        return { ok: false, status: 401, error: "invalid_token" };
      }
      const scopes = typeof scope === "string" ? scope.split(" ") : [];
      if (!scopes.includes(config.mcpScope)) {
        return { ok: false, status: 403, error: "insufficient_scope" };
      }
      return { ok: true, claims: { sub, clientId } };
    },
  };
}
