import type { Attention, AttentionCounts, AttentionKind, AttentionLine, BatchLine, PackComment, Role } from "@a11-wild/shared";
import type { ClientApprovals } from "../auth/clients.js";
import type { BatchStore } from "../batch/store.js";
import { mayWaitForMeta, pageOf, waitOf } from "../batch/waits.js";
import type { BrandStore } from "../brand/store.js";
import type { MetaStore } from "../meta/store.js";
import type { OutreachSequence } from "../outreach/sequence.js";
import type { OutreachStore } from "../outreach/store.js";
import { todayLists } from "../outreach/today.js";
import type { CommentStore } from "../pack/comments.js";
import type { PackService } from "../pack/service.js";
import type { PackStore } from "../pack/store.js";
import type { ProposalStore } from "../taste/proposals.js";

export interface AttentionDeps {
  batches: Pick<BatchStore, "list">;
  brands: Pick<BrandStore, "brand" | "product">;
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
    const { batches, brands, meta } = this.deps;
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
        const [brand, product, metaWaits] = await Promise.all([
          once(brandOf, batch.brandId, (id) => brands.brand(id)),
          once(productOf, batch.productId, (id) => brands.product(id)),
          mayWaitForMeta(batch) ? meta.all(batch.id).then(unapproved) : false,
        ]);
        const { id, label, kind, state, test, purpose, createdAt } = batch;
        return {
          batch: { id, kind, state, createdAt, ...(label ? { label } : {}), ...(test ? { test } : {}), ...(purpose ? { purpose } : {}) },
          brand: { id: brand.id, name: brand.name },
          product: { id: product.id, name: product.name },
          ...waitOf(batch, metaWaits),
          to: pageOf(batch),
        };
      }),
    );
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

/** Whether an ad has Meta text and no version the owner approved. */
function unapproved(texts: { ideaId: string; approved?: unknown }[]): boolean {
  const ideas = new Map<string, boolean>();
  for (const text of texts) ideas.set(text.ideaId, (ideas.get(text.ideaId) ?? false) || Boolean(text.approved));
  return [...ideas.values()].some((approved) => !approved);
}
