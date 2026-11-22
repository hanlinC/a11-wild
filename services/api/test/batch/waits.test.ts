import type { Batch, BatchKind, BatchState } from "@a11-wild/shared";
import { BATCH_STATES } from "@a11-wild/shared";
import { describe, expect, it } from "vitest";
import { mayWaitForPick, pageOf, spendStagesOf, waitOf } from "../../src/batch/waits.js";

const batch = (kind: BatchKind, state: BatchState, extra: Partial<Pick<Batch, "test" | "purpose">> = {}) => ({ kind, state, ...extra });

describe("who a batch waits for", () => {
  it("waits for the owner's pick of a draft while an idea has none, at the board and after the first final", () => {
    for (const state of ["waiting_pick", "finals"] as const) expect(waitOf(batch("v1", state), { picksLeft: 1 })).toEqual({ who: "owner", text: "Pick one draft for each idea." });
  });

  it("is the agent's turn at the board once every idea has the owner's pick", () => {
    expect(waitOf(batch("v1", "waiting_pick"), { picksLeft: 0 })).toEqual({ who: "agent", text: "The agent makes the finals." });
    expect(waitOf(batch("v1", "finals"), { picksLeft: 0 }).who).toBe("agent");
  });

  it("waits for the owner's three concepts once the critic reviewed a concept ad", () => {
    expect(waitOf(batch("v3", "reviewed"), {})).toEqual({ who: "owner", text: "Pick three concepts." });
  });

  it("waits for the owner's yes to the words of an ad with words, in chat", () => {
    for (const kind of ["v2", "v3"] as const) expect(waitOf(batch(kind, "judged"), {})).toMatchObject({ who: "owner", chat: true });
    expect(waitOf(batch("v1", "judged"), {}).who).toBe("agent");
  });

  it("waits for the owner's yes to a cost that has none, at any step, in chat and before anything else", () => {
    expect(waitOf(batch("v2", "priced"), { spend: "drafts" })).toEqual({ who: "owner", text: "Say yes or no to the cost of the drafts.", chat: true });
    expect(waitOf(batch("v1", "waiting_pick"), { spend: "finals", picksLeft: 2 }).text).toBe("Say yes or no to the cost of the finals.");
    expect(waitOf(batch("v3", "ideas"), { spend: "roughs" })).toMatchObject({ who: "owner", chat: true });
  });

  it("is the agent's turn at the estimate once the owner said yes", () => {
    expect(waitOf(batch("v2", "waiting_spend"), {})).toEqual({ who: "agent", text: "The agent makes the drafts." });
  });

  it("reads the estimate of the stage a batch is in, and no rough outside a concept ad", () => {
    expect(spendStagesOf(batch("v1", "priced"))).toEqual(["drafts"]);
    expect(spendStagesOf(batch("v1", "finals"))).toEqual(["finals"]);
    expect(spendStagesOf(batch("v3", "ideas"))).toEqual(["research", "roughs"]);
    expect(spendStagesOf(batch("v2", "ideas"))).toEqual(["research"]);
    expect(spendStagesOf(batch("v1", "done"))).toEqual([]);
    expect(spendStagesOf(batch("v1", "priced", { purpose: "outreach" }))).toEqual([]);
  });

  it("waits for the owner's yes to Meta text that has none, once the ads are picked", () => {
    for (const state of ["finals", "finished", "done"] as const) expect(waitOf(batch("v2", state), { meta: true })).toMatchObject({ who: "owner", chat: true });
    expect(waitOf(batch("v2", "drafting"), { meta: true }).who).toBe("agent");
  });

  it("is the agent's turn at every other step, and nobody's at the end", () => {
    expect(waitOf(batch("v1", "drafting"), {})).toEqual({ who: "agent", text: "The agent checks the drafts, and a blind critic ranks them." });
    expect(waitOf(batch("v3", "truth"), {}).text).toBe("The agent writes the brief.");
    expect(waitOf(batch("v1", "done"), {}).who).toBe("nobody");
    expect(waitOf(batch("v1", "spec_only"), {}).who).toBe("nobody");
  });

  it("never waits for the owner in a test batch or an outreach batch, at any step", () => {
    for (const extra of [{ test: true as const }, { purpose: "outreach" as const }]) {
      for (const kind of ["v1", "v2", "v3"] as const) {
        for (const state of BATCH_STATES) expect(waitOf(batch(kind, state, extra), { spend: "drafts", picksLeft: 3, meta: true }).who, `${kind} ${state}`).not.toBe("owner");
      }
      expect(mayWaitForPick(batch("v1", "waiting_pick", extra))).toBe(false);
    }
    expect(waitOf(batch("v2", "judged", { purpose: "outreach" }), {}).text).toBe("The agent chooses in your place.");
    // The draft of an outreach ad is the owner's own pick, on the brand's page.
    expect(waitOf(batch("v1", "waiting_pick", { purpose: "outreach" }), {})).toEqual({ who: "nobody", text: "Its drafts are on the brand's page in Outreach. You pick there." });
    expect(waitOf(batch("v1", "finals", { purpose: "outreach" }), {}).who).toBe("agent");
    expect(waitOf(batch("v1", "waiting_pick", { test: true }), {}).text).toBe("A test: the tester chooses in your place.");
  });

  it("has words for every state of every kind", () => {
    for (const kind of ["v1", "v2", "v3"] as const) for (const state of BATCH_STATES) expect(waitOf(batch(kind, state), {}).text.length).toBeGreaterThan(3);
  });
});

describe("the page of a batch", () => {
  it("is the concepts of a concept ad until its drafts are made, and the board after", () => {
    expect(pageOf({ id: "b", kind: "v3", state: "reviewed" })).toBe("/batches/b/concepts");
    expect(pageOf({ id: "b", kind: "v3", state: "waiting_pick" })).toBe("/batches/b");
    expect(pageOf({ id: "b", kind: "v1", state: "ideas" })).toBe("/batches/b");
  });
});
