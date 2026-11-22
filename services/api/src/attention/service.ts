import type { Attention, AttentionCounts, AttentionKind, AttentionLine, Batch, BatchLine, MetaText, PackComment, Role } from "@a11-wild/shared";
import type { ClientApprovals } from "../auth/clients.js";
import type { BatchStore } from "../batch/store.js";
import { type BatchFacts, mayWaitForMeta, mayWaitForPick, pageOf, spendStagesOf, waitOf } from "../batch/waits.js";
import type { BrandStore } from "../brand/store.js";
import type { MetaStore } from "../meta/store.js";
import type { OutreachSequence } from "../outreach/sequence.js";
import type { OutreachStore } from "../outreach/store.js";
import { todayLists } from "../outreach/today.js";
import type { CommentStore } from "../pack/comments.js";
import type { PackService } from "../pack/service.js";
import type { PackStore } from "../pack/store.js";
import type { PickStore } from "../picks/store.js";
import { type SpendGate, waitsForYes } from "../spend/gate.js";
import type { ProposalStore } from "../taste/proposals.js";

export interface AttentionDeps {
  batches: Pick<BatchStore, "list" | "ideas">;
  brands: Pick<BrandStore, "brand" | "product">;
  gate: Pick<SpendGate, "peek">;
  picks: Pick<PickStore, "all">;
  meta: Pick<MetaStore, "all">;
  outreach: { store: OutreachStore; sequence: OutreachSequence };
  packs: Pick<PackStore, "all">;
  pack: Pick<PackService, "current" | "onCurrentAds">;
  comments: Pick<CommentStore, "all">;
  proposals: Pick<ProposalStore, "list">;
  approvals: Pick<ClientApprovals, "list">;
  now: () => Date;
}

/** A change request the owner has not closed, as the Clients page counts it. */
export const waitsForOwner = (comment: Pick<PackComment, "change">): boolean => comment.change?.status === "received" || comment.change?.status === "in_work";

const PAGE: Record<AttentionKind, string> = {
  replies: "/outreach",
  ads: "/outreach",
  follow_ups: "/outreach",
  firsts: "/outreach",
  change_requests: "/clients",
  taste: "/taste",
  connections: "/connections",
};

/**
 * What waits for the owner, joined at the moment it is asked for. It stores nothing and signs no picture link:
 * each part uses the test of the page that shows it, so a count here and a list there cannot disagree.
 */
export class AttentionService {
  constructor(private readonly deps: AttentionDeps) {}

  async read(role: Role): Promise<Attention> {
    const owner = role === "owner";
    const [all, lines] = await Promise.all([this.batches(), owner ? this.lines() : []]);
    // A member reads that a batch waits for the owner, and nothing of what he is asked.
    const batches = owner ? all : all.map(({ chat: _chat, ...line }) => (line.who === "owner" ? { ...line, text: "Waits for the owner." } : line));
    const of = (...kinds: AttentionKind[]) => lines.filter((line) => kinds.includes(line.kind)).reduce((sum, line) => sum + line.count, 0);
    const counts: AttentionCounts = owner
      ? {
          studio: batches.filter((line) => line.who === "owner").length,
          outreach: of("replies", "ads", "follow_ups", "firsts"),
          clients: of("change_requests"),
          taste: of("taste"),
          connections: of("connections"),
        }
      : { studio: 0 };
    return { batches, lines, counts };
  }

  private async batches(): Promise<BatchLine[]> {
    const { batches, brands } = this.deps;
    // One read for each brand and each product, however many batches share it.
    const brandOf = new Map<string, ReturnType<typeof brands.brand>>();
    const productOf = new Map<string, ReturnType<typeof brands.product>>();
    const once = <T>(seen: Map<string, Promise<T>>, id: string, read: (id: string) => Promise<T>): Promise<T> => {
      const known = seen.get(id) ?? read(id);
      seen.set(id, known);
      return known;
    };
    return Promise.all(
      (await batches.list()).map(async (batch): Promise<BatchLine> => {
        const [brand, product, facts] = await Promise.all([
          once(brandOf, batch.brandId, (id) => brands.brand(id)),
          once(productOf, batch.productId, (id) => brands.product(id)),
          this.facts(batch),
        ]);
        const { id, label, kind, state, test, purpose, createdAt } = batch;
        return {
          batch: { id, kind, state, createdAt, ...(label ? { label } : {}), ...(test ? { test } : {}), ...(purpose ? { purpose } : {}) },
          brand: { id: brand.id, name: brand.name },
          product: { id: product.id, name: product.name },
          ...waitOf(batch, facts),
          to: pageOf(batch),
        };
      }),
    );
  }

  /** What only the stores say of a batch. Nothing is read for a batch that cannot wait for the owner at its state. */
  private async facts(batch: Batch): Promise<BatchFacts> {
    const { batches, gate, picks, meta } = this.deps;
    const [estimates, picksLeft, text] = await Promise.all([
      Promise.all(spendStagesOf(batch).map(async (stage) => ({ stage, estimate: await gate.peek(batch.id, stage) }))),
      mayWaitForPick(batch) ? Promise.all([batches.ideas(batch.id), picks.all(batch.id)]).then(([ideas, made]) => ideas.filter((idea) => !made.some((pick) => pick.ideaId === idea.id)).length) : 0,
      mayWaitForMeta(batch) ? meta.all(batch.id).then(textWaits) : false,
    ]);
    const spend = estimates.find(({ estimate }) => estimate && waitsForYes(estimate))?.stage;
    return { ...(spend ? { spend } : {}), picksLeft, meta: text };
  }

  private async lines(): Promise<AttentionLine[]> {
    const { outreach, proposals, approvals, now } = this.deps;
    const [today, requests, proposed, programs] = await Promise.all([
      todayLists({ ...outreach, now }),
      this.requests(),
      proposals.list().then((all) => all.filter((proposal) => proposal.status === "proposed").length),
      approvals.list().then((all) => all.filter((client) => client.status === "pending").length),
    ]);
    const found: [AttentionKind, number][] = [
      ["replies", today.owed.length],
      ["ads", today.adsWaiting.length],
      ["follow_ups", today.followUps.length],
      ["firsts", today.firsts.length],
      ["change_requests", requests],
      ["taste", proposed],
      ["connections", programs],
    ];
    return found.filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count, to: PAGE[kind] }));
  }

  /** The change requests the owner has not closed, on the ads a pack still carries. */
  private async requests(): Promise<number> {
    const { packs, pack, comments } = this.deps;
    const counts = await Promise.all(
      (await packs.all()).map(async (one) => {
        const version = await pack.current(one);
        if (!version) return 0;
        return (await pack.onCurrentAds(one, version, await comments.all(one.id))).filter(waitsForOwner).length;
      }),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }
}

/**
 * Whether an ad has Meta text saved after the owner's last yes to that ad's text. The agent asks him about each version it saves,
 * so a newer one waits though an older one has his yes. His yes to the older one again, after it, keeps the older one and ends the wait.
 */
function textWaits(texts: Pick<MetaText, "ideaId" | "at" | "approved">[]): boolean {
  const ads = new Map<string, { saved: string; yes: string }>();
  for (const text of texts) {
    const ad = ads.get(text.ideaId) ?? { saved: "", yes: "" };
    ads.set(text.ideaId, { saved: text.at > ad.saved ? text.at : ad.saved, yes: text.approved && text.approved.at > ad.yes ? text.approved.at : ad.yes });
  }
  return [...ads.values()].some((ad) => ad.yes < ad.saved);
}
