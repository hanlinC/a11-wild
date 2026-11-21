import { createHash } from "node:crypto";
import { type Batch, type CriticRank, FUNNEL_STAGES, type Idea, type IdeaVerdict, type StagePick } from "@a11-wild/shared";
import { hasWords, requireMove } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { BoardService } from "../board/service.js";
import type { BrandStore } from "../brand/store.js";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import { DRAFTS_PER_IDEA } from "../render/service.js";
import type { TruthStore } from "../truth/store.js";
import { burstPacket, draftsPacket, ideasPacket, rankable } from "./packet.js";
import type { CriticStep, CriticStore, Ticket } from "./store.js";

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  truth: TruthStore;
  facts: FactStore;
  board: BoardService;
  critic: CriticStore;
}

export const BLIND_NEEDED =
  "A blind critic is needed: a fresh helper that gets the batch id and nothing else. The session that wrote the ideas or made the drafts cannot judge them. If you cannot start a fresh helper, tell the owner and stop.";
const BAD_TICKET = "This ticket is not valid: it was used, it ran out, or it is not of this batch. A ticket works once. Start a fresh helper and call critic_open again.";
/** The states in which drafts can be ranked: from the first finished drafts until the owner has chosen for every idea. */
const RANKING = ["drafting", "checked", "waiting_pick", "finals"];

const stampOf = (ideas: Idea[]) => createHash("sha256").update(JSON.stringify(ideas)).digest("hex").slice(0, 32);
/** The author's order says which ideas he wrote first. A critic gets them in another order, the same for one burst. */
const shuffled = (ideas: Idea[], stamp: string) => {
  const place = (idea: Idea) => createHash("sha256").update(`${stamp}:${idea.id}`).digest("hex");
  return [...ideas].sort((a, b) => place(a).localeCompare(place(b)));
};
const once = (ids: string[]) => new Set(ids).size === ids.length;
const same = (a: string[], b: string[]) => a.length === b.length && once(a) && a.every((id) => b.includes(id));

/** The blind judgement of a batch: a fresh critic opens a packet, and its word is taken once, with the packet's ticket. */
export class CriticService {
  constructor(private readonly deps: Deps) {}

  async open(batchId: string, step: CriticStep, freshHelper: boolean) {
    if (!freshHelper) throw new Refusal(BLIND_NEEDED);
    const { batches, brands, truth, facts, board, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (batch.format !== "static_4x5") throw new Refusal("This batch ends with a text spec. The blind critic judges a batch whose pictures the studio makes.");
    const product = await brands.product(batch.productId);
    const common = {
      brand: await brands.brand(batch.brandId),
      product,
      truthSheet: (await truth.get(batch.productId, batch.truthVersion)) ?? null,
      facts: await facts.list(product.id),
    };
    const ideas = await this.judgedAt(batch, step);
    const stamp = stampOf(ideas);

    if (step === "ideas") {
      if (batch.state !== "ideas") requireMove(batch, "judged", "critic_open");
      if (ideas.length === 0) throw new Refusal("This batch has no ideas yet. The main agent saves them first (ideas_save).");
      if (hasWords(batch.kind)) {
        return { ...burstPacket(common, shuffled(ideas, stamp)), ...(await critic.issue(batchId, { step, ideaIds: ideas.map((idea) => idea.id), stamp })) };
      }
      return { ...ideasPacket(common, ideas), ...(await critic.issue(batchId, { step, ideaIds: ideas.map((idea) => idea.id), stamp })) };
    }
    if (!RANKING.includes(batch.state)) requireMove(batch, "checked", "critic_open");
    const open = rankable(await board.board(batchId), DRAFTS_PER_IDEA);
    if (open.length === 0) {
      throw new Refusal(`No idea of this batch can be ranked now. An idea is ranked when its ${DRAFTS_PER_IDEA} drafts are finished and the owner has not chosen for it yet.`);
    }
    const shown = Object.fromEntries(open.flatMap(({ drafts }) => drafts.map((draft) => [draft.imageId, draft.shownId])));
    return { ...draftsPacket(common, open), ...(await critic.issue(batchId, { step, ideaIds: open.map(({ idea }) => idea.id), stamp, shown })) };
  }

  /** The ideas a step judges: the whole burst when a critic chooses from many, else the batch's ideas. */
  private judgedAt(batch: Batch, step: CriticStep): Promise<Idea[]> {
    return step === "ideas" && hasWords(batch.kind) ? this.deps.batches.burst(batch.id) : this.deps.batches.ideas(batch.id);
  }

  /** The ticket of this batch and this step, checked against the ideas as they are now. It is not spent yet. */
  private async ticket(batch: Batch, ticket: string, step: CriticStep, judged?: string[]): Promise<Ticket> {
    const found = await this.deps.critic.read(batch.id, ticket);
    if (!found || found.step !== step) throw new Refusal(BAD_TICKET);
    if (found.stamp !== stampOf(await this.judgedAt(batch, step))) {
      throw new Refusal("The ideas of this batch changed after this ticket was made. Start a fresh helper and call critic_open again.");
    }
    if (judged && !same(judged, found.ideaIds)) throw new Refusal(`Judge each idea of the packet once, and no other: ${found.ideaIds.join(", ")}.`);
    return found;
  }

  /** The critic's choice of one idea for each funnel stage. A batch with all three is judged; a refused stage gets more ideas. */
  async select(batchId: string, ticket: string, picks: StagePick[]) {
    const { batches, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (!hasWords(batch.kind)) throw new Refusal("A v1 batch has three ideas, and the critic keeps or cuts each one: use critic_pick.");
    if (batch.state !== "ideas") requireMove(batch, "judged", "critic_select");
    const stages = picks.map((pick) => pick.stage);
    if (!same(stages, [...FUNNEL_STAGES])) throw new Refusal("Give each of tof, mof and bof once: an idea, or ideaId null to refuse the stage.");
    await this.ticket(batch, ticket, "ideas");
    const burst = await batches.burst(batchId);
    const chosen: Idea[] = [];
    for (const stage of FUNNEL_STAGES) {
      const pick = picks.find((entry) => entry.stage === stage) as StagePick;
      if (pick.ideaId === null) continue;
      const idea = burst.find((entry) => entry.id === pick.ideaId);
      if (!idea) throw new Refusal(`The packet has no idea ${pick.ideaId}.`);
      if (idea.stage !== stage) throw new Refusal(`${idea.id} is a ${idea.stage} idea. It cannot be the ${stage} choice.`);
      chosen.push(idea);
    }
    if (!(await critic.use(batchId, ticket))) throw new Refusal(BAD_TICKET);
    await critic.saveStages(batchId, picks);
    const refused = picks.filter((pick) => pick.ideaId === null);
    if (refused.length > 0) {
      return {
        state: batch.state,
        refused: refused.map(({ stage, reason }) => ({ stage, reason })),
        nextStep: "Report the refused stages and what is missing. The main agent writes more ideas for them (ideas_save with the whole burst again), and then a fresh critic chooses again.",
      };
    }
    await batches.saveIdeas(batchId, chosen, "critic");
    const moved = await batches.move(batch, "judged", "critic_select");
    return {
      state: moved.state,
      chosen: chosen.map((idea) => idea.id),
      nextStep: "Report the three ideas you chose, with your reasons. The main agent shows the owner their words and waits for his yes (copy_approve).",
    };
  }

  /** The critic's keep or cut for each idea. A batch whose ideas are all kept is judged. */
  async pick(batchId: string, ticket: string, verdicts: IdeaVerdict[]) {
    const { batches, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (hasWords(batch.kind)) throw new Refusal("A batch with words has a burst of ideas, and the critic chooses one for each funnel stage: use critic_select.");
    if (batch.state !== "ideas") requireMove(batch, "judged", "critic_pick");
    await this.ticket(batch, ticket, "ideas", verdicts.map((verdict) => verdict.ideaId));
    if (!(await critic.use(batchId, ticket))) throw new Refusal(BAD_TICKET);
    await critic.saveVerdicts(batchId, verdicts);
    const cut = verdicts.filter((verdict) => verdict.verdict === "cut");
    if (cut.length > 0) {
      return {
        state: batch.state,
        cut: cut.map(({ ideaId, reason }) => ({ ideaId, reason })),
        nextStep: "Report the cut ideas and your reasons. The main agent writes a new idea in place of each one (ideas_save with all three), and then a fresh critic judges again.",
      };
    }
    const moved = await batches.move(batch, "judged", "critic_pick");
    return {
      state: moved.state,
      nextStep: "Report that the three ideas are kept, with your reasons. The main agent now sends one draft to read its price.",
    };
  }

  /** The critic's order of each idea's drafts. It is refused for an idea the owner has already chosen for. */
  async rank(batchId: string, ticket: string, ranks: { ideaId: string; order: { imageId: string; reason: string }[] }[]) {
    const { batches, board, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (!RANKING.includes(batch.state)) requireMove(batch, "checked", "critic_rank");
    const { shown = {} } = await this.ticket(batch, ticket, "drafts", ranks.map((rank) => rank.ideaId));
    const open = rankable(await board.board(batchId), DRAFTS_PER_IDEA);
    const saved: Omit<CriticRank, "at">[] = [];
    for (const rank of ranks) {
      const entry = open.find(({ idea }) => idea.id === rank.ideaId);
      if (!entry) throw new Refusal(`The drafts of ${rank.ideaId} cannot be ranked now: the owner has chosen for it, or its drafts changed. Start a fresh helper and call critic_open again.`);
      const drafts = entry.drafts.map((draft) => draft.imageId);
      if (!same(rank.order.map((place) => place.imageId), drafts)) throw new Refusal(`Put every draft of ${rank.ideaId} in the order once, and no other picture: ${drafts.join(", ")}.`);
      // The rank is of the pictures the packet showed. A draft repaired since then is another picture.
      if (entry.drafts.some((draft) => shown[draft.imageId] !== draft.shownId)) {
        throw new Refusal(`A draft of ${rank.ideaId} was repaired after your packet was made, so you looked at a picture that no longer counts. Start a fresh helper and call critic_open again.`);
      }
      saved.push({ ideaId: rank.ideaId, order: rank.order.map((place) => ({ imageId: place.imageId, shownId: shown[place.imageId] as string, reason: place.reason })) });
    }
    if (!(await critic.use(batchId, ticket))) throw new Refusal(BAD_TICKET);
    for (const rank of saved) await critic.saveRank(batchId, rank);
    const { batch: after, missing } = await board.progress(batch);
    return {
      saved: ranks.map((rank) => rank.ideaId),
      state: after.state,
      ...(missing.length > 0 ? { stillMissing: missing } : {}),
      nextStep: "Report that the drafts are ranked. Do not tell the main agent or the owner your order: the owner picks first.",
    };
  }
}
