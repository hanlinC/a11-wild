import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { Jwks } from "aws-jwt-verify/jwk";
import type { Config } from "../../src/config.js";

const KID = "test-key";

/** A signing key that stands in for the user pool's key, and the key set that verifies it. */
export async function createSigner() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  const jwks = { keys: [jwk] } as unknown as Jwks;

  async function sign(claims: Record<string, unknown>, expiresIn: string | number = "1h"): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: KID }).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey);
  }

  return {
    jwks,
    sign,
    /** An MCP access token as the user pool issues it after sign-in with the resource address. */
    accessToken(config: Config, overrides: Record<string, unknown> = {}, expiresIn?: string | number) {
      return sign(
        {
          iss: config.issuer,
          aud: config.mcpResource,
          token_use: "access",
          scope: `openid ${config.mcpScope}`,
          sub: "sub-owner",
          client_id: "client-1",
          ...overrides,
        },
        expiresIn,
      );
    },
    idToken(config: Config, overrides: Record<string, unknown> = {}) {
      return sign({
        iss: config.issuer,
        aud: config.dashboardClientId,
        token_use: "id",
        sub: "sub-owner",
        email: "owner@example.com",
        ...overrides,
      });
    },
  };
}

export type Signer = Awaited<ReturnType<typeof createSigner>>;
