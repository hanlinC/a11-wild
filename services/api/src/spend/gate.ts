import type { Role } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import type { Item, Table } from "../store/table.js";
import { showUsd, toMicro, toUsd } from "./money.js";

/** The estimate at which a batch waits for the owner's yes. */
export const ASK_FROM_USD = 1;

export type GateStage = "research" | "roughs" | "drafts" | "finals";

/** The stage cannot continue yet. The message says what it waits for. */
export class GateError extends Refusal {}

interface GateItem extends Item {
  count: number;
  estimateMicro: number;
  /** The price of the first item, which the estimate counts for each one not yet sent. */
  eachMicro?: number;
  approvedMicro?: number;
  approvedBy?: string;
  approvedAt?: string;
}

export interface GateState {
  count: number;
  estimateUsd: number;
  needsYes: boolean;
  approvedBy?: string;
}

/** Whether an estimate waits for the owner's yes. */
export const waitsForYes = (state: GateState): boolean => state.needsYes && !state.approvedBy;

const key = (batchId: string, stage: GateStage) => [`BATCH#${batchId}`, `GATE#${stage}`] as const;

/**
 * The owner's rule for paid renders: the first item of a stage is sent alone to read the real
 * price; an estimate under US$1 continues, and US$1 or more waits for the owner's yes.
 */
export class SpendGate {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  private view(item: GateItem): GateState {
    const needsYes = item.estimateMicro >= toMicro(ASK_FROM_USD);
    // A yes covers the estimate the owner saw. A larger one is a new question.
    const approved = item.approvedMicro !== undefined && item.approvedMicro >= item.estimateMicro;
    return {
      count: item.count,
      estimateUsd: toUsd(item.estimateMicro),
      needsYes,
      ...(approved ? { approvedBy: item.approvedBy } : {}),
    };
  }

  /**
   * Saves the estimate for a stage from the real price of its first item. `billed` is what failed items
   * before it were charged, and how many of the stage's places they hold: a place held is not sent again.
   */
  async price(batchId: string, stage: GateStage, first: { firstUsd: number; count: number; billed?: { micro: number; places: number } }): Promise<GateState> {
    const [pk, sk] = key(batchId, stage);
    const earlier = await this.table.get<GateItem>(pk, sk);
    const item: GateItem = { ...earlier, pk, sk, count: first.count, estimateMicro: toMicro(first.firstUsd * (first.count - (first.billed?.places ?? 0))) + (first.billed?.micro ?? 0), eachMicro: toMicro(first.firstUsd) };
    await this.table.put(item);
    return this.view(item);
  }

  /** Records the owner's yes for the estimate shown. Nobody else can give it. */
  async approve(batchId: string | undefined, stage: GateStage, user: { email: string; role: Role }): Promise<GateState> {
    if (user.role !== "owner") throw new GateError("Only the owner can approve spend.");
    if (!batchId && stage !== "research") throw new GateError(`A yes for ${stage} needs the batch id. Only research can belong to no batch.`);
    const [pk, sk] = key(batchId ?? this.noBatch(), stage);
    const item = await this.table.get<GateItem>(pk, sk);
    if (!item) throw new GateError(`There is no estimate for the ${stage} of ${batchId ? "this batch" : "this month's research outside a batch"} yet, so there is nothing to approve.`);
    const approved: GateItem = {
      ...item,
      approvedMicro: item.estimateMicro,
      approvedBy: user.email,
      approvedAt: this.now().toISOString(),
    };
    await this.table.put(approved);
    return this.view(approved);
  }

  /** Where research that belongs to no batch is counted: one place for each month. */
  private noBatch(): string {
    return `no-batch-${this.now().toISOString().slice(0, 7)}`;
  }

  /**
   * The same rule for research, which has no count to estimate from: a batch's research goes on
   * freely while its total stays under US$1, and each further US$1 waits for the owner's yes.
   * Research that belongs to no batch is held the same way, on its total for the month.
   */
  async research(batchId: string | undefined, usedMicro: number, nextMicro: number): Promise<void> {
    const [pk, sk] = key(batchId ?? this.noBatch(), "research");
    const item = await this.table.get<GateItem>(pk, sk);
    const step = toMicro(ASK_FROM_USD);
    const allowed = Math.max(step, item?.approvedMicro ?? 0);
    if (usedMicro + nextMicro < allowed) return;
    const asked = allowed + step;
    if (item?.estimateMicro !== asked) await this.table.put({ ...item, pk, sk, count: 0, estimateMicro: asked });
    const whose = batchId ? "This batch's research" : "This month's research outside a batch";
    throw new GateError(
      `This waits for the owner's yes. ${whose} has used ${showUsd(usedMicro)}, and this call needs about ${showUsd(nextMicro)}. It may spend under ${showUsd(allowed)} so far. Show the owner these amounts. His yes lets it go on up to ${showUsd(asked)}. Only the owner can approve (spend_approve with stage "research"${batchId ? "" : " and no batchId"}). Nothing was sent.`,
    );
  }

  /** The estimate of a stage as it stands, or nothing before its first item gave a price. */
  async peek(batchId: string, stage: GateStage): Promise<GateState | undefined> {
    const item = await this.table.get<GateItem>(...key(batchId, stage));
    return item ? this.view(item) : undefined;
  }

  /**
   * Passes when the next item of the stage may be sent. Throws a GateError that says what is missing.
   * `next` is the item about to be sent, with how many the stage has sent and what the stage came to
   * so far. The estimate is then what it came to, this item, and the first one's price for each of the
   * rest. One more item than it counted (a redo, the drafts of a lowered direction), a dearer item (more
   * reference pictures) or a failed one that was charged makes it larger, and a larger estimate is a new
   * question for the owner. An item that was refused and never sent leaves nothing behind in it.
   */
  async check(batchId: string, stage: GateStage, next?: { sent: number; usedMicro: number; micro: number }): Promise<GateState> {
    let item = await this.table.get<GateItem>(...key(batchId, stage));
    if (!item) {
      throw new GateError(`Send the first of the ${stage} alone, to read the real price. The rest wait for that price.`);
    }
    if (next && item.count > 0) {
      const count = Math.max(item.count, next.sent + 1);
      // An estimate saved before each item's price was kept: its price is the estimate over its count, kept from now on.
      const eachMicro = item.eachMicro ?? Math.round(item.estimateMicro / item.count);
      const rest = (count - next.sent - 1) * eachMicro;
      const projected = Math.round(next.usedMicro + next.micro + rest);
      // A micro-dollar of rounding for each item is not another estimate.
      const moved = Math.abs(projected - item.estimateMicro) > count;
      if (count > item.count || moved) {
        item = { ...item, count, eachMicro, estimateMicro: moved ? projected : item.estimateMicro };
        await this.table.put(item);
      }
    }
    const state = this.view(item);
    if (waitsForYes(state)) {
      throw new GateError(
        `This batch waits for the owner's yes: ${item.count} ${stage} at about ${showUsd(item.estimateMicro)} in total. Show the owner the count and the estimate. Only the owner can approve.`,
      );
    }
    return state;
  }
}
