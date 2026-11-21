import { beforeEach, describe, expect, it } from "vitest";
import { pruneClients } from "../../src/jobs/prune-clients.js";
import { createStudio, type Studio } from "../helpers/deps.js";

const NOW = new Date("2026-11-21T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

let studio: Studio;
beforeEach(async () => {
  studio = await createStudio();
});

describe("daily clean-up of self-registered clients", () => {
  it("deletes an old client that was never seen or approved", async () => {
    studio.cognito.register("stranger", { createdAt: hoursAgo(25) });
    expect(await pruneClients(studio.cognito, studio.approvals, NOW)).toEqual(["stranger"]);
    expect(studio.cognito.clients.has("stranger")).toBe(false);
  });

  it("deletes an old pending client and forgets its record", async () => {
    studio.cognito.register("waiting", { createdAt: hoursAgo(25) });
    await studio.approvals.statusOf("waiting", "owner@example.com");
    await pruneClients(studio.cognito, studio.approvals, NOW);
    expect(studio.cognito.clients.has("waiting")).toBe(false);
    expect(await studio.approvals.list()).toEqual([]);
  });

  it("keeps an approved client however old it is", async () => {
    studio.cognito.register("trusted", { createdAt: hoursAgo(24 * 90) });
    await studio.approvals.statusOf("trusted", "owner@example.com");
    await studio.approvals.approve("trusted");
    expect(await pruneClients(studio.cognito, studio.approvals, NOW)).toEqual([]);
    expect(studio.cognito.clients.has("trusted")).toBe(true);
  });

  it("keeps a pending client that is two hours old", async () => {
    studio.cognito.register("fresh", { createdAt: hoursAgo(2) });
    await studio.approvals.statusOf("fresh", "owner@example.com");
    expect(await pruneClients(studio.cognito, studio.approvals, NOW)).toEqual([]);
    expect(studio.cognito.clients.has("fresh")).toBe(true);
  });

  it("keeps a client the owner approves while the clean-up runs", async () => {
    studio.cognito.register("late", { createdAt: hoursAgo(25) });
    await studio.approvals.statusOf("late", "owner@example.com");
    // The clean-up read the record as pending; the approval lands before it deletes.
    const read = studio.approvals.get.bind(studio.approvals);
    studio.approvals.get = async (clientId) => {
      const record = await read(clientId);
      await studio.approvals.approve(clientId);
      return record;
    };

    expect(await pruneClients(studio.cognito, studio.approvals, NOW)).toEqual([]);
    expect(studio.cognito.clients.has("late")).toBe(true);
    expect((await read("late"))?.status).toBe("approved");
  });
});
