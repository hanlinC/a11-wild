import type { Batch, BatchKind, BatchState } from "@a11-wild/shared";
import { BATCH_STATES } from "@a11-wild/shared";
import { describe, expect, it } from "vitest";
import { pageOf, waitOf } from "../../src/batch/waits.js";

const batch = (kind: BatchKind, state: BatchState, extra: Partial<Pick<Batch, "test" | "purpose">> = {}) => ({ kind, state, ...extra });

describe("who a batch waits for", () => {
  it("waits for the owner's pick of a draft at the pick board", () => {
    expect(waitOf(batch("v1", "waiting_pick"))).toEqual({ who: "owner", text: "Pick one draft for each idea." });
  });

  it("waits for the owner's three concepts once the critic reviewed a concept ad", () => {
    expect(waitOf(batch("v3", "reviewed"))).toEqual({ who: "owner", text: "Pick three concepts." });
  });

  it("waits for the owner's yes to the words of an ad with words, in chat", () => {
    for (const kind of ["v2", "v3"] as const) expect(waitOf(batch(kind, "judged"))).toMatchObject({ who: "owner", chat: true });
    expect(waitOf(batch("v1", "judged")).who).toBe("agent");
  });

  it("waits for the owner's yes to the cost, in chat", () => {
    expect(waitOf(batch("v2", "waiting_spend"))).toMatchObject({ who: "owner", chat: true });
  });

  it("waits for the owner's yes to Meta text that has none, once the ads are picked", () => {
    for (const state of ["finals", "finished", "done"] as const) expect(waitOf(batch("v2", state), true)).toMatchObject({ who: "owner", chat: true });
    expect(waitOf(batch("v2", "drafting"), true).who).toBe("agent");
  });

  it("is the agent's turn at every other step, and nobody's at the end", () => {
    expect(waitOf(batch("v1", "drafting"))).toEqual({ who: "agent", text: "The agent checks the drafts, and a blind critic ranks them." });
    expect(waitOf(batch("v3", "truth")).text).toBe("The agent writes the brief.");
    expect(waitOf(batch("v1", "done")).who).toBe("nobody");
    expect(waitOf(batch("v1", "spec_only")).who).toBe("nobody");
  });

  it("never waits for the owner in a test batch or an outreach batch, at any step", () => {
    for (const extra of [{ test: true as const }, { purpose: "outreach" as const }]) {
      for (const kind of ["v1", "v2", "v3"] as const) {
        for (const state of BATCH_STATES) expect(waitOf(batch(kind, state, extra), true).who, `${kind} ${state}`).not.toBe("owner");
      }
    }
    expect(waitOf(batch("v1", "waiting_pick", { purpose: "outreach" })).text).toBe("The agent chooses in your place.");
    expect(waitOf(batch("v1", "waiting_pick", { test: true })).text).toBe("A test: the tester chooses in your place.");
  });

  it("has words for every state of every kind", () => {
    for (const kind of ["v1", "v2", "v3"] as const) for (const state of BATCH_STATES) expect(waitOf(batch(kind, state)).text.length).toBeGreaterThan(3);
  });
});

describe("the page of a batch", () => {
  it("is the concepts of a concept ad until its drafts are made, and the board after", () => {
    expect(pageOf({ id: "b", kind: "v3", state: "reviewed" })).toBe("/batches/b/concepts");
    expect(pageOf({ id: "b", kind: "v3", state: "waiting_pick" })).toBe("/batches/b");
    expect(pageOf({ id: "b", kind: "v1", state: "ideas" })).toBe("/batches/b");
  });
});
