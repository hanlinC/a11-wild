import { createHash, randomBytes } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Jwks } from "aws-jwt-verify/jwk";
import type { Config } from "../config.js";

/** Sign-in state lives ten minutes: long enough to type a password, short enough to be useless later. */
export const LOGIN_STATE_SECONDS = 600;
export const LOGIN_COOKIE = "__Host-a11w_login";

export interface LoginState {
  state: string;
  verifier: string;
  nonce: string;
}

export function newLoginState(): LoginState {
  const random = () => randomBytes(32).toString("base64url");
  return { state: random(), verifier: random(), nonce: random() };
}

export function encodeLoginState(login: LoginState): string {
  return Buffer.from(JSON.stringify(login)).toString("base64url");
}

export function decodeLoginState(value: string | undefined): LoginState | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { state, verifier, nonce } = parsed as Record<string, unknown>;
    if (typeof state !== "string" || typeof verifier !== "string" || typeof nonce !== "string") return undefined;
    return { state, verifier, nonce };
  } catch {
    return undefined;
  }
}

export function callbackUrl(config: Config): string {
  return `${config.publicOrigin}/auth/callback`;
}

/** The managed login address that starts the authorization-code flow with PKCE. */
export function authorizeUrl(config: Config, login: LoginState): string {
  const url = new URL(`${config.cognitoDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.dashboardClientId,
    redirect_uri: callbackUrl(config),
    scope: "openid email",
    state: login.state,
    nonce: login.nonce,
    code_challenge: createHash("sha256").update(login.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function logoutUrl(config: Config): string {
  const url = new URL(`${config.cognitoDomain}/logout`);
  url.search = new URLSearchParams({
    client_id: config.dashboardClientId,
    logout_uri: `${config.publicOrigin}/`,
  }).toString();
  return url.toString();
}

export interface Identity {
  sub: string;
  email: string;
}

/** Trades the authorization code for the signed-in person's identity. */
export interface DashboardSignIn {
  identify(code: string, login: LoginState): Promise<Identity | undefined>;
}

export function createDashboardSignIn(config: Config, fetchFn: typeof fetch = fetch, jwks?: Jwks): DashboardSignIn {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    clientId: config.dashboardClientId,
    tokenUse: "id",
  });
  if (jwks) verifier.cacheJwks(jwks);

  return {
    async identify(code, login) {
      const response = await fetchFn(`${config.cognitoDomain}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.dashboardClientId,
          code,
          redirect_uri: callbackUrl(config),
          code_verifier: login.verifier,
        }),
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { id_token?: unknown };
      if (typeof body.id_token !== "string") return undefined;
      try {
        const claims = await verifier.verify(body.id_token);
        if (claims.nonce !== login.nonce || typeof claims.email !== "string") return undefined;
        return { sub: claims.sub, email: claims.email };
      } catch {
        return undefined;
      }
    },
  };
}
