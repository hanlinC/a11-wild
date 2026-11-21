import { pruneClients } from "./jobs/prune-clients.js";
import { wire } from "./wire.js";

const ready = wire();

export const handler = async (): Promise<void> => {
  const { cognito, approvals } = await ready;
  await pruneClients(cognito, approvals);
};
