import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@a11-wild/shared";
import type { Config } from "../config.js";
import type { Item, Table } from "../store/table.js";
import type { User } from "./users.js";

const PK = "SESSION";

/** `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and on path "/". */
export const SESSION_COOKIE = "__Host-a11w_session";

export interface Session {
  sub: string;
  email: string;
  role: Role;
}

type SessionItem = Item & Session & { expiresAt: number };

/** Only a hash of the session id is stored, so a read of the table gives no usable session. */
function keyOf(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("base64url");
}

export async function createSession(table: Table, config: Config, user: User, now: Date): Promise<string> {
  const sessionId = randomBytes(32).toString("base64url");
  const item: SessionItem = {
    pk: PK,
    sk: keyOf(sessionId),
    sub: user.sub,
    email: user.email,
    role: user.role,
    expiresAt: Math.floor(now.getTime() / 1000) + config.sessionSeconds,
  };
  await table.put(item);
  return sessionId;
}

export async function readSession(table: Table, sessionId: string | undefined, now: Date): Promise<Session | undefined> {
  if (!sessionId) return undefined;
  const item = await table.get<SessionItem>(PK, keyOf(sessionId));
  // The table's own expiry can lag by hours, so the time is checked here too.
  if (!item || item.expiresAt <= Math.floor(now.getTime() / 1000)) return undefined;
  return { sub: item.sub, email: item.email, role: item.role };
}

export async function deleteSession(table: Table, sessionId: string | undefined): Promise<void> {
  if (sessionId) await table.delete(PK, keyOf(sessionId));
}
