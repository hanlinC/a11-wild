import { OUTREACH_STAGES, type Batch, type OutreachAd, type OutreachStage, type OutreachTier, type ProspectBrief, type ProspectFile } from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { IdeaFinal } from "../board/service.js";
import { Refusal } from "../mcp/registry.js";
import type { SpendLedger } from "../spend/ledger.js";
import { chosen, sameContact } from "./sequence.js";
import { adWaits, kindOf, optedOut, stageOf, wantsAd } from "./stage.js";
import type { OutreachStore } from "./store.js";

/** The owner's campaign: the first 50 product brands of his two top tiers, in list order. */
export const CAMPAIGN = { brands: 50, tiers: ["20+", "5-19"] as readonly OutreachTier[] } as const;

export interface NextBrand extends ProspectBrief {
  /** `first`: no ad yet. `again`: the owner said no to its ad. `more`: the brand replied and asked for one more. */
  why: "first" | "again" | "more";
  /** The owner's words with his no. The next ad is made from them. */
  ownerSaid?: string;
  /** What the brand sells, when someone has marked it. */
  sells?: "product";
  /** An outreach batch of this brand that is not done: resume it before you start a new one. */
  openBatchId?: string;
  /** A done outreach batch of this brand whose ad is not on its page yet: attach it before you start a new one. */
  doneBatchId?: string;
}

interface Deps {
  store: OutreachStore;
  batches: BatchStore;
  board: { finals(batch: Batch): Promise<IdeaFinal[]> };
  ledger: SpendLedger;
}

/** What an agent may read of a prospect: nothing that reaches a person. */
function briefOf(file: ProspectFile): ProspectBrief {
  const { id, n, brand, sector, liveAds, tier, newestAd, instagram } = file.profile;
  return { id, n, brand, sector, liveAds, tier, ...(newestAd ? { newestAd } : {}), ...(instagram ? { instagram } : {}) };
}

const inCampaign = (file: ProspectFile): boolean => !file.profile.test && CAMPAIGN.tiers.includes(file.profile.tier);

/** The agent's side of the outreach: which brand needs an ad, and where a finished ad goes. It reads and returns no contact. */
export class OutreachDesk {
  constructor(private readonly deps: Deps) {}

  private async read() {
    const { store, batches } = this.deps;
    const [files, optOuts, all] = await Promise.all([store.all(), store.optOuts(), batches.list()]);
    // Newest first, so the first one found for a prospect is its newest.
    const open = new Map<string, string>();
    const newest = new Map<string, Batch>();
    for (const batch of all) {
      if (batch.purpose !== "outreach" || !batch.prospectId) continue;
      if (!newest.has(batch.prospectId)) newest.set(batch.prospectId, batch);
      if (batch.state !== "done" && !open.has(batch.prospectId)) open.set(batch.prospectId, batch.id);
    }
    // A session that stopped between batch_done and outreach_attach left a paid ad that is on no page.
    const done = new Map<string, string>();
    for (const file of files) {
      const batch = newest.get(file.profile.id);
      if (batch?.state === "done" && !file.ads.some((ad) => ad.batchId === batch.id)) done.set(file.profile.id, batch.id);
    }
    const started = files.filter((file) => inCampaign(file) && file.ads.length > 0).length;
    return { files, optOuts, open, done, started, shared: sameContact(files) };
  }

  /** The brands that need an ad now: a "more" reply first, then the list's order. */
  async next(limit: number): Promise<{ brands: NextBrand[]; brandsWithAnAd: number; brandsLimit: number }> {
    const { files, optOuts, open, done, started, shared } = await this.read();
    const more: { at: string; brand: NextBrand }[] = [];
    const others: NextBrand[] = [];
    let firsts = Math.max(0, CAMPAIGN.brands - started);
    for (const file of files) {
      if (file.profile.test) continue;
      const want = wantsAd(file, optOuts);
      if (!want) continue;
      const openBatchId = open.get(file.profile.id);
      const doneBatchId = openBatchId ? undefined : done.get(file.profile.id);
      const brand: NextBrand = { ...briefOf(file), why: want.why, ...(want.ownerSaid ? { ownerSaid: want.ownerSaid } : {}), ...(kindOf(file) === "product" ? { sells: "product" as const } : {}), ...(openBatchId ? { openBatchId } : {}), ...(doneBatchId ? { doneBatchId } : {}) };
      if (want.why === "more") {
        const asked = file.events.filter((event) => event.type === "reply" && event.reply === "more").at(-1);
        more.push({ at: asked?.at ?? "", brand });
        continue;
      }
      if (!inCampaign(file)) continue;
      // One person gets the first message once: a brand that shares its contact with an earlier one waits for the owner's choice.
      if (shared.has(file.profile.id) && !chosen(file)) continue;
      if (want.why === "first") {
        if (firsts === 0) continue;
        firsts -= 1;
      }
      others.push(brand);
    }
    more.sort((a, b) => a.at.localeCompare(b.at));
    return { brands: [...more.map((entry) => entry.brand), ...others].slice(0, limit), brandsWithAnAd: started, brandsLimit: CAMPAIGN.brands };
  }

  private async file(id: string) {
    const read = await this.read();
    const file = read.files.find((entry) => entry.profile.id === id);
    if (!file) throw new Refusal(`There is no prospect ${id}. outreach_next gives the brands that need an ad.`);
    return { ...read, file };
  }

  /** Refuses an outreach batch for a brand that needs no ad now. */
  async checkNew(prospectId: string): Promise<void> {
    const { file, optOuts, started } = await this.file(prospectId);
    if (file.profile.test) throw new Refusal("That is a test prospect. No ad is made for it.");
    const want = wantsAd(file, optOuts);
    if (!want) throw new Refusal(adWaits(file) ? "An ad of this brand waits for the owner's yes or no. Make no other until he has answered." : `This brand is at "${stageOf(file, optOuts)}": it needs no ad now. outreach_next gives the brands that do.`);
    if (want.why === "more") return;
    if (!inCampaign(file)) throw new Refusal(`The campaign is for the tiers ${CAMPAIGN.tiers.join(" and ")} live ads. This brand is in "${file.profile.tier}".`);
    if (want.why === "first" && started >= CAMPAIGN.brands) throw new Refusal(`The campaign's ${CAMPAIGN.brands} brands have their ad. A new brand needs the owner's say.`);
  }

  /** What the brand sells, or that no good ad can be made for it. Only for a brand the owner has not written to. */
  async mark(id: string, input: { mark: "product" | "service" | "parked"; reason?: string | undefined }): Promise<{ stage: OutreachStage }> {
    const { store } = this.deps;
    const { file, optOuts } = await this.file(id);
    if (optedOut(file, optOuts)) throw new Refusal("This contact opted out. Nothing is changed for it.");
    if (file.sends.length > 0) throw new Refusal("The owner has written to this brand. Tell him what you found: only he changes it now.");
    if (input.mark === "parked") {
      if (!input.reason) throw new Refusal("Give the reason: what was missing for a good ad (too few facts, no usable real photo).");
      const stage = stageOf(file, optOuts);
      if (stage !== "new") throw new Refusal(`Only a brand with no ad can be parked. This one is at "${stage}".`);
      await store.addEvent(id, { type: "stage", stage: "parked", reason: input.reason }, "agent");
    } else {
      await store.addEvent(id, { type: "kind", kind: input.mark }, "agent");
    }
    const after = (await store.all()).find((entry) => entry.profile.id === id) as ProspectFile;
    return { stage: stageOf(after, optOuts) };
  }

  /** Puts the one final of a done outreach batch on its prospect's page, where it waits for the owner's yes or no. */
  async attach(batchId: string, why: string): Promise<{ ad: Omit<OutreachAd, "key">; already: boolean }> {
    const { store, batches, board } = this.deps;
    const batch = await batches.get(batchId);
    if (batch.purpose !== "outreach" || !batch.prospectId) throw new Refusal("This is not an outreach batch. Only the ad of a batch that was started for a prospect is attached.");
    if (batch.state !== "done") throw new Refusal(`This batch is "${batch.state}". Only the final of a done batch is attached: run batch_done first.`);
    const { file, optOuts } = await this.file(batch.prospectId);
    const shown = ({ key: _key, ...ad }: OutreachAd) => ad;
    const before = file.ads.find((ad) => ad.batchId === batch.id);
    if (before) return { ad: shown(before), already: true };
    const picked = (await board.finals(batch)).filter((entry) => entry.pick?.imageId);
    const final = picked[0];
    if (picked.length !== 1 || !final) throw new Refusal("An outreach batch has one picked final. This one does not.");
    // A final that fails a check is not attached, even in a batch that was done before the check was saved.
    if (!final.delivered) throw new Refusal(`The final is not ready for the owner: ${final.missing.join("; ")}.`);
    if (!wantsAd(file, optOuts)) throw new Refusal(adWaits(file) ? "An ad of this brand waits for the owner's yes or no. No other is attached until he has answered." : `This brand is at "${stageOf(file, optOuts)}": it takes no ad now.`);
    const saved = await store.putAd(file.profile.id, file.ads.length + 1, { batchId: batch.id, imageId: final.delivered.id, kind: batch.kind, key: final.delivered.key, why });
    if (saved) return { ad: shown(saved), already: false };
    // Another attach came first: it is the same batch, or the brand has its ad now.
    const again = (await store.all()).find((entry) => entry.profile.id === file.profile.id)?.ads.find((ad) => ad.batchId === batch.id);
    if (again) return { ad: shown(again), already: true };
    throw new Refusal("Another ad was attached to this brand at the same moment. It waits for the owner's yes or no.");
  }

  /** The campaign in numbers. It names no brand and holds no contact. */
  async state() {
    const { files, optOuts, started } = await this.read();
    const count = (of: ProspectFile[]) => {
      const stages = Object.fromEntries(OUTREACH_STAGES.map((stage) => [stage, 0])) as Record<OutreachStage, number>;
      for (const file of of) stages[stageOf(file, optOuts)] += 1;
      return stages;
    };
    const real = files.filter((file) => !file.profile.test);
    const campaign = real.filter(inCampaign);
    const wants = { first: 0, again: 0, more: 0 };
    for (const file of real) {
      const want = wantsAd(file, optOuts);
      if (want && (want.why === "more" || inCampaign(file))) wants[want.why] += 1;
    }
    const spend = (await this.deps.ledger.summary()).campaign;
    return {
      prospects: real.length,
      stages: count(real),
      campaign: { tiers: CAMPAIGN.tiers, prospects: campaign.length, stages: count(campaign), brandsWithAnAd: started, brandsLimit: CAMPAIGN.brands },
      ads: { waitForTheOwner: real.filter((file) => adWaits(file) && !optedOut(file, optOuts)).length, wanted: wants },
      firstMessagesSent: real.filter((file) => file.sends.some((send) => send.step === 0)).length,
      spend,
    };
  }
}
