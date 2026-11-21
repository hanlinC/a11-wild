import type { ClientApprovals, CognitoClients } from "../auth/clients.js";
import { log } from "../log.js";

export const UNAPPROVED_CLIENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes app clients that registered themselves and that the owner did not
 * approve within a day. Anyone can register a client, so this keeps strangers
 * from filling the user pool's client quota.
 */
export async function pruneClients(
  cognito: CognitoClients,
  approvals: ClientApprovals,
  now: Date = new Date(),
): Promise<string[]> {
  const deleted: string[] = [];
  for (const client of await cognito.listRegistered()) {
    const record = await approvals.get(client.clientId);
    if (record?.status === "approved") continue;
    if (now.getTime() - client.createdAt.getTime() < UNAPPROVED_CLIENT_MAX_AGE_MS) continue;
    // The record goes first, and only while it still says pending: an approval
    // that lands during this run wins, and the client is kept.
    if (record?.status === "pending" && !(await approvals.forgetIfPending(client.clientId))) continue;
    await cognito.delete(client.clientId);
    deleted.push(client.clientId);
  }
  log.info("clients_pruned", { deleted: deleted.length });
  return deleted;
}
