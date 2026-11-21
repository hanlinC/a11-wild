import { beforeEach, describe, expect, it } from "vitest";
import { BudgetError, NotBilledError, SpendLedger } from "../../src/spend/ledger.js";
import { MemoryTable } from "../helpers/memory-table.js";

let table: MemoryTable;
let ledger: SpendLedger;
const now = () => new Date("2026-11-22T03:00:00Z");

beforeEach(() => {
  table = new MemoryTable();
  ledger = new SpendLedger(table, now, { monthUsd: 25, batchUsd: 5 });
});

const draft = (usd: number, batchId = "batch-1") => ({ service: "fal" as const, kind: "draft", ref: "idea-1", batchId, usd });

describe("spend ledger", () => {
  it("counts a reserve at once, before the call is sent", async () => {
    await ledger.reserve(draft(0.5));
    const summary = await ledger.summary();
    expect(summary).toMatchObject({ month: "2026-11", monthUsd: 0.5, monthCapUsd: 25, batchCapUsd: 5 });
    expect(summary.lines).toEqual([expect.objectContaining({ service: "fal", kind: "draft", usd: 0.5, status: "reserved" })]);
  });

  it("refuses a reserve that would pass the monthly cap and writes nothing", async () => {
    await ledger.reserve({ service: "parallel", kind: "task", ref: "brand", usd: 24.5 });
    await expect(ledger.reserve({ service: "parallel", kind: "task", ref: "brand", usd: 0.6 })).rejects.toThrow(BudgetError);
    const summary = await ledger.summary();
    expect(summary.monthUsd).toBe(24.5);
    expect(summary.lines).toHaveLength(1);
  });

  it("accepts exactly one of two reserves sent at once that together pass the batch cap", async () => {
    const results = await Promise.allSettled([ledger.reserve(draft(3)), ledger.reserve(draft(3))]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const summary = await ledger.summary("batch-1");
    expect(summary.batchUsd).toBe(3);
    // The refused one gave its share of the month back.
    expect(summary.monthUsd).toBe(3);
  });

  it("names the cap, the amount used and the amount asked for when it refuses", async () => {
    await ledger.reserve(draft(4.9));
    await expect(ledger.reserve(draft(0.2))).rejects.toThrow(/batch.*US\$4\.90.*US\$5\.00.*US\$0\.20/s);
  });

  it("settles a reserve to the real cost", async () => {
    const value = await ledger.paid(draft(0.5), async () => ({ value: "picture", usd: 0.31 }));
    expect(value).toBe("picture");
    const summary = await ledger.summary("batch-1");
    expect(summary).toMatchObject({ monthUsd: 0.31, batchUsd: 0.31 });
    expect(summary.lines).toEqual([expect.objectContaining({ usd: 0.31, status: "spent" })]);
  });

  it("releases the reserve when the provider surely did not take the call", async () => {
    await expect(
      ledger.paid(draft(0.5), async () => {
        throw new NotBilledError("The provider refused the request.");
      }),
    ).rejects.toThrow("The provider refused the request.");
    const summary = await ledger.summary("batch-1");
    expect(summary).toMatchObject({ monthUsd: 0, batchUsd: 0 });
    expect(summary.lines).toEqual([expect.objectContaining({ status: "released" })]);
  });

  it("keeps the reserve counted when the outcome is unknown", async () => {
    await expect(
      ledger.paid(draft(0.5), async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
    const summary = await ledger.summary("batch-1");
    expect(summary).toMatchObject({ monthUsd: 0.5, batchUsd: 0.5 });
    expect(summary.lines).toEqual([expect.objectContaining({ status: "reserved" })]);
  });

  it("starts each calendar month at zero", async () => {
    await ledger.reserve(draft(2));
    const december = new SpendLedger(table, () => new Date("2026-12-01T00:00:01Z"), { monthUsd: 25, batchUsd: 5 });
    expect((await december.summary()).monthUsd).toBe(0);
  });

  it("holds money without rounding drift", async () => {
    for (let i = 0; i < 3; i++) await ledger.reserve(draft(0.1));
    expect((await ledger.summary("batch-1")).batchUsd).toBe(0.3);
  });
});
