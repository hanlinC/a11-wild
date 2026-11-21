import { beforeEach, describe, expect, it } from "vitest";
import { GateError, SpendGate } from "../../src/spend/gate.js";
import { MemoryTable } from "../helpers/memory-table.js";

let gate: SpendGate;
const owner = { sub: "sub-owner", email: "owner@example.com", role: "owner" as const };
const member = { sub: "sub-member", email: "member@example.com", role: "member" as const };

beforeEach(() => {
  gate = new SpendGate(new MemoryTable(), () => new Date("2026-11-22T03:00:00Z"));
});

describe("spend gate", () => {
  it("refuses the rest of a stage before the first item was sent alone for its price", async () => {
    await expect(gate.check("batch-1", "drafts")).rejects.toThrow(/first .* alone/);
  });

  it("lets the other eight drafts go when the estimate is under US$1", async () => {
    const priced = await gate.price("batch-1", "drafts", { firstUsd: 0.84 / 9, count: 9 });
    expect(priced).toMatchObject({ estimateUsd: 0.84, needsYes: false });
    await expect(gate.check("batch-1", "drafts")).resolves.toMatchObject({ estimateUsd: 0.84 });
  });

  it("waits for the owner's yes at US$1 or more, and shows the count and the estimate", async () => {
    const priced = await gate.price("batch-1", "drafts", { firstUsd: 1.2 / 9, count: 9 });
    expect(priced).toMatchObject({ estimateUsd: 1.2, needsYes: true });
    await expect(gate.check("batch-1", "drafts")).rejects.toThrow(GateError);
    await expect(gate.check("batch-1", "drafts")).rejects.toThrow(/9 drafts.*US\$1\.20.*owner/s);
  });

  it("treats exactly US$1 as needing a yes", async () => {
    expect((await gate.price("batch-1", "drafts", { firstUsd: 0.25, count: 4 })).needsYes).toBe(true);
  });

  it("refuses a member's yes and accepts the owner's", async () => {
    await gate.price("batch-1", "drafts", { firstUsd: 1.2 / 9, count: 9 });
    await expect(gate.approve("batch-1", "drafts", member)).rejects.toThrow(/Only the owner/);
    await expect(gate.check("batch-1", "drafts")).rejects.toThrow(GateError);

    await gate.approve("batch-1", "drafts", owner);
    await expect(gate.check("batch-1", "drafts")).resolves.toMatchObject({ approvedBy: "owner@example.com" });
  });

  it("asks again when a new price makes the estimate larger than the one the owner approved", async () => {
    await gate.price("batch-1", "drafts", { firstUsd: 1.2 / 9, count: 9 });
    await gate.approve("batch-1", "drafts", owner);
    await gate.price("batch-1", "drafts", { firstUsd: 0.4, count: 9 });
    await expect(gate.check("batch-1", "drafts")).rejects.toThrow(/US\$3\.60/);
  });

  it("holds the gate for finals apart from the gate for drafts", async () => {
    await gate.price("batch-1", "drafts", { firstUsd: 0.05, count: 9 });
    await expect(gate.check("batch-1", "finals")).rejects.toThrow(/first .* alone/);
  });

  it("has no yes to give before a price is known", async () => {
    await expect(gate.approve("batch-1", "drafts", owner)).rejects.toThrow(/no estimate/);
  });

  it("lets research go on under US$1 and asks again at each further US$1", async () => {
    const owner = { email: "owner@example.com", role: "owner" as const };
    await gate.research("b1", 900_000, 99_999);
    await expect(gate.research("b1", 900_000, 100_000)).rejects.toThrow(/up to US\$2\.00/);
    await gate.approve("b1", "research", owner);
    await gate.research("b1", 1_000_000, 999_999);
    await expect(gate.research("b1", 1_900_000, 100_000)).rejects.toThrow(/up to US\$3\.00/);
    // The yes for US$2 does not cover the next question.
    await expect(gate.research("b1", 1_900_000, 100_000)).rejects.toThrow(GateError);
  });
});
