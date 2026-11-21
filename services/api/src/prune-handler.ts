import { pruneClients } from "./jobs/prune-clients.js";
import { wireClients } from "./wire.js";

const ready = wireClients();

export const handler = async (): Promise<void> => {
  const { cognito, approvals } = await ready;
  await pruneClients(cognito, approvals);
};
