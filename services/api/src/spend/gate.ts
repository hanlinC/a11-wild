import type { Role } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import type { Item, Table } from "../store/table.js";
import { showUsd, toMicro, toUsd } from "./money.js";

/** The estimate at which a batch waits for the owner's yes. */
export const ASK_FROM_USD = 1;

export type GateStage = "research" | "drafts" | "finals";

/** The stage cannot continue yet. The message says what it waits for. */
export class GateError extends Refusal {}

interface GateItem extends Item {
  count: number;
  estimateMicro: number;
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

  /** Saves the estimate for a stage from the real price of its first item. */
  async price(batchId: string, stage: GateStage, first: { firstUsd: number; count: number }): Promise<GateState> {
    const [pk, sk] = key(batchId, stage);
    const earlier = await this.table.get<GateItem>(pk, sk);
    const item: GateItem = { ...earlier, pk, sk, count: first.count, estimateMicro: toMicro(first.firstUsd * first.count) };
    await this.table.put(item);
    return this.view(item);
  }

  /** Records the owner's yes for the estimate shown. Nobody else can give it. */
  async approve(batchId: string, stage: GateStage, user: { email: string; role: Role }): Promise<GateState> {
    if (user.role !== "owner") throw new GateError("Only the owner can approve spend.");
    const [pk, sk] = key(batchId, stage);
    const item = await this.table.get<GateItem>(pk, sk);
    if (!item) throw new GateError(`There is no estimate for the ${stage} of this batch yet, so there is nothing to approve.`);
    const approved: GateItem = {
      ...item,
      approvedMicro: item.estimateMicro,
      approvedBy: user.email,
      approvedAt: this.now().toISOString(),
    };
    await this.table.put(approved);
    return this.view(approved);
  }

  /**
   * The same rule for research, which has no count to estimate from: a batch's research goes on
   * freely while its total stays under US$1, and each further US$1 waits for the owner's yes.
   */
  async research(batchId: string, usedMicro: number, nextMicro: number): Promise<void> {
    const [pk, sk] = key(batchId, "research");
    const item = await this.table.get<GateItem>(pk, sk);
    const step = toMicro(ASK_FROM_USD);
    const allowed = Math.max(step, item?.approvedMicro ?? 0);
    if (usedMicro + nextMicro < allowed) return;
    const asked = allowed + step;
    if (item?.estimateMicro !== asked) await this.table.put({ ...item, pk, sk, count: 0, estimateMicro: asked });
    throw new GateError(
      `This batch waits for the owner's yes: its research has used ${showUsd(usedMicro)}, and this call needs about ${showUsd(nextMicro)}. The batch may spend under ${showUsd(allowed)} on research so far. Show the owner these amounts. His yes lets research go on up to ${showUsd(asked)}. Only the owner can approve (spend_approve with stage "research"). Nothing was sent.`,
    );
  }

  /** Passes when the rest of the stage may be sent. Throws a GateError that says what is missing. */
  async check(batchId: string, stage: GateStage): Promise<GateState> {
    const item = await this.table.get<GateItem>(...key(batchId, stage));
    if (!item) {
      throw new GateError(`Send the first of the ${stage} alone, to read the real price. The rest wait for that price.`);
    }
    const state = this.view(item);
    if (state.needsYes && !state.approvedBy) {
      throw new GateError(
        `This batch waits for the owner's yes: ${item.count} ${stage} at about ${showUsd(item.estimateMicro)} in total. Show the owner the count and the estimate. Only the owner can approve.`,
      );
    }
    return state;
  }
}
