import { beforeEach, describe, expect, it } from "vitest";
import { GateError, SpendGate } from "../../src/spend/gate.js";
import { MemoryTable } from "../helpers/memory-table.js";

let gate: SpendGate;
let table: MemoryTable;
const owner = { sub: "sub-owner", email: "owner@example.com", role: "owner" as const };
const member = { sub: "sub-member", email: "member@example.com", role: "member" as const };

beforeEach(() => {
  table = new MemoryTable();
  gate = new SpendGate(table, () => new Date("2026-11-22T03:00:00Z"));
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

  it("counts a render past the estimate, and asks when that takes the stage to US$1", async () => {
    await gate.price("batch-1", "drafts", { firstUsd: 0.1, count: 9 });
    // The ninth is inside the estimate; a redo after nine is one more, and ten make US$1.
    const after = (sent: number, micro = 100_000) => ({ sent, usedMicro: sent * 100_000, micro });
    expect((await gate.check("batch-1", "drafts", after(8))).count).toBe(9);
    await expect(gate.check("batch-1", "drafts", after(9))).rejects.toThrow(/10 drafts at about US\$1\.00/);
    await gate.approve("batch-1", "drafts", owner);
    expect((await gate.check("batch-1", "drafts", after(9))).approvedBy).toBe("owner@example.com");
    // The yes covers ten. The three drafts of a lowered direction are a new question.
    await expect(gate.check("batch-1", "drafts", after(10))).rejects.toThrow(/11 drafts/);
  });

  it("counts a dearer item than the first, and asks when that takes the stage to US$1", async () => {
    // Twelve finals priced from a first one with one reference picture (US$0.073). One with five costs US$0.113.
    await gate.price("batch-1", "finals", { firstUsd: 0.073, count: 12 });
    const next = (dear: number, micro: number) => ({ sent: 1 + dear, usedMicro: 73_000 + dear * 113_000, micro });
    expect((await gate.check("batch-1", "finals", next(0, 73_000))).estimateUsd).toBeCloseTo(0.876);
    for (const dear of [0, 1, 2]) expect((await gate.check("batch-1", "finals", next(dear, 113_000))).needsYes).toBe(false);
    // The fourth dear one takes the twelve to US$1.036.
    await expect(gate.check("batch-1", "finals", next(3, 113_000))).rejects.toThrow(/12 finals at about US\$1\.036/);
    // It was not sent. A final with one picture in its place keeps the stage under US$1, and needs no yes.
    expect(await gate.check("batch-1", "finals", next(3, 73_000))).toMatchObject({ needsYes: false, count: 12 });
    await expect(gate.check("batch-1", "finals", next(3, 113_000))).rejects.toThrow(/US\$1\.036/);
    await gate.approve("batch-1", "finals", owner);
    expect((await gate.check("batch-1", "finals", next(3, 113_000))).approvedBy).toBe("owner@example.com");
  });

  it("keeps the price of each item of an estimate that was saved without one", async () => {
    await gate.price("batch-1", "finals", { firstUsd: 0.113, count: 3 });
    const [pk, sk] = ["BATCH#batch-1", "GATE#finals"];
    const saved = await table.get<{ pk: string; sk: string; eachMicro?: number }>(pk, sk);
    expect(saved?.eachMicro).toBe(113_000);
    const { eachMicro: _each, ...older } = saved!;
    await table.put(older);
    // A cheaper final lowers the estimate, and the two after it still count at the first one's price.
    expect((await gate.check("batch-1", "finals", { sent: 0, usedMicro: 0, micro: 73_000 })).estimateUsd).toBeCloseTo(0.073 + 2 * 0.113);
    expect((await gate.check("batch-1", "finals", { sent: 1, usedMicro: 73_000, micro: 73_000 })).estimateUsd).toBeCloseTo(2 * 0.073 + 0.113);
  });

  it("counts a failed item that was charged", async () => {
    await gate.price("batch-1", "drafts", { firstUsd: 0.1, count: 9 });
    // Eight stand, and one more failed after fal charged for it: the ninth takes the stage to US$1.
    await expect(gate.check("batch-1", "drafts", { sent: 8, usedMicro: 900_000, micro: 100_000 })).rejects.toThrow(/9 drafts at about US\$1\.00/);
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
