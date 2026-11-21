import { randomUUID } from "node:crypto";
import type { SpendLine, SpendService, SpendSummary } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import type { Item, Table } from "../store/table.js";
import { showUsd, toMicro, toUsd } from "./money.js";

/** The owner's caps. A batch cannot spend more than its cap, and all batches together cannot pass the month's. */
export const CAPS = { monthUsd: 25, batchUsd: 5 } as const;

/** A cap would be passed. Nothing was sent and nothing was written. */
export class BudgetError extends Refusal {}

/**
 * It is sure that the provider did not take the call: it refused the request, or the call was never sent.
 * Any other failure (a timeout, a broken connection, a reply that cannot be read) has an unknown outcome,
 * so its reserve stays counted for the rest of the month.
 */
export class NotBilledError extends Refusal {}

export interface PaidCall {
  service: SpendService;
  /** What is bought, for example "extract" or "draft". */
  kind: string;
  /** What it is for: a page address, an idea, a draft. Shown in the ledger. */
  ref: string;
  batchId?: string;
  /** The estimate, in US dollars. */
  usd: number;
}

export interface Reservation {
  month: string;
  sk: string;
  batchId?: string;
  micro: number;
}

interface LineItem extends Item {
  service: SpendService;
  kind: string;
  ref: string;
  batchId?: string;
  micro: number;
  status: SpendLine["status"];
  at: string;
}

const monthKey = (month: string) => `SPEND#${month}`;
const batchKey = (batchId: string) => `BATCH#${batchId}`;
const TOTAL = "TOTAL";
const BATCH_TOTAL = "SPEND";

export class SpendLedger {
  private readonly monthCap: number;
  private readonly batchCap: number;

  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
    caps: { monthUsd: number; batchUsd: number } = CAPS,
  ) {
    this.monthCap = toMicro(caps.monthUsd);
    this.batchCap = toMicro(caps.batchUsd);
  }

  private month(): string {
    return this.now().toISOString().slice(0, 7);
  }

  private async used(pk: string, sk: string): Promise<number> {
    const item = await this.table.get(pk, sk);
    return typeof item?.micro === "number" ? item.micro : 0;
  }

  /**
   * Counts the estimate against both caps before anything is sent. Each cap is one conditional
   * write, so calls sent at the same time cannot pass it together.
   */
  async reserve(call: PaidCall): Promise<Reservation> {
    const month = this.month();
    const micro = toMicro(call.usd);
    if (!(micro > 0)) throw new BudgetError("A paid call needs an estimate above zero.");

    if (!(await this.table.add(monthKey(month), TOTAL, "micro", micro, { ceiling: this.monthCap }))) {
      throw new BudgetError(await this.refusal("month", await this.used(monthKey(month), TOTAL), this.monthCap, micro));
    }
    if (call.batchId) {
      const pk = batchKey(call.batchId);
      if (!(await this.table.add(pk, BATCH_TOTAL, "micro", micro, { ceiling: this.batchCap }))) {
        await this.table.add(monthKey(month), TOTAL, "micro", -micro);
        throw new BudgetError(await this.refusal("batch", await this.used(pk, BATCH_TOTAL), this.batchCap, micro));
      }
    }

    const at = this.now().toISOString();
    const sk = `LINE#${at}#${randomUUID()}`;
    const line: LineItem = {
      pk: monthKey(month),
      sk,
      service: call.service,
      kind: call.kind,
      ref: call.ref.slice(0, 200),
      ...(call.batchId ? { batchId: call.batchId } : {}),
      micro,
      status: "reserved",
      at,
    };
    await this.table.put(line);
    return { month, sk, micro, ...(call.batchId ? { batchId: call.batchId } : {}) };
  }

  private refusal(cap: "month" | "batch", used: number, limit: number, asked: number): string {
    return `The ${cap}'s spend cap would be passed: ${showUsd(used)} used of ${showUsd(limit)}, and this call needs about ${showUsd(asked)}. Nothing was sent.`;
  }

  private async close(reservation: Reservation, status: "spent" | "released", micro: number): Promise<void> {
    const delta = micro - reservation.micro;
    if (delta !== 0) {
      await this.table.add(monthKey(reservation.month), TOTAL, "micro", delta);
      if (reservation.batchId) await this.table.add(batchKey(reservation.batchId), BATCH_TOTAL, "micro", delta);
    }
    const line = await this.table.get<LineItem>(monthKey(reservation.month), reservation.sk);
    if (line) await this.table.put({ ...line, micro, status });
  }

  /** The provider took the call. `usd` is the real cost when the provider reports one. */
  async settle(reservation: Reservation, usd?: number): Promise<void> {
    await this.close(reservation, "spent", usd === undefined ? reservation.micro : toMicro(usd));
  }

  /** The provider surely did not take the call, so it stops counting. */
  async release(reservation: Reservation): Promise<void> {
    await this.close(reservation, "released", 0);
  }

  /** The one way a paid call leaves the server: reserve, send, then settle to the real cost. */
  async paid<T>(call: PaidCall, send: () => Promise<{ value: T; usd?: number }>): Promise<T> {
    const reservation = await this.reserve(call);
    try {
      const { value, usd } = await send();
      await this.settle(reservation, usd);
      return value;
    } catch (error) {
      if (error instanceof NotBilledError) await this.release(reservation);
      throw error;
    }
  }

  /**
   * What a batch has spent or still holds in reserve with one service this month, in micro-dollars.
   * With no batch id, the same for the calls that belong to no batch.
   */
  async batchMicro(batchId: string | undefined, service: SpendService): Promise<number> {
    const items = await this.table.query<LineItem>(monthKey(this.month()));
    return items
      .filter((item) => item.sk.startsWith("LINE#") && item.batchId === batchId && item.service === service && item.status !== "released")
      .reduce((sum, item) => sum + item.micro, 0);
  }

  /** This month's total, the caps and the lines; with a batch id, that batch's total and lines. */
  async summary(batchId?: string): Promise<SpendSummary> {
    const month = this.month();
    const items = await this.table.query<LineItem>(monthKey(month));
    const lines = items
      .filter((item) => item.sk.startsWith("LINE#") && (!batchId || item.batchId === batchId))
      .sort((a, b) => (a.sk < b.sk ? 1 : -1))
      .map(
        (item): SpendLine => ({
          at: item.at,
          service: item.service,
          kind: item.kind,
          ref: item.ref,
          ...(item.batchId ? { batchId: item.batchId } : {}),
          usd: toUsd(item.micro),
          status: item.status,
        }),
      );
    return {
      month,
      monthUsd: toUsd(await this.used(monthKey(month), TOTAL)),
      monthCapUsd: toUsd(this.monthCap),
      batchCapUsd: toUsd(this.batchCap),
      ...(batchId ? { batchId, batchUsd: toUsd(await this.used(batchKey(batchId), BATCH_TOTAL)) } : {}),
      lines,
    };
  }
}
