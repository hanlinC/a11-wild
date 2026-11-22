import { createHash } from "node:crypto";
import { type Batch, type ConceptReview, type CriticRank, FUNNEL_STAGES, type Idea, type IdeaVerdict, type StagePick } from "@a11-wild/shared";
import { hasWords, requireMove } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { BoardService } from "../board/service.js";
import type { BrandStore } from "../brand/store.js";
import type { FactStore } from "../facts/store.js";
import type { ImageStore } from "../images/store.js";
import type { Pictures } from "../pictures/store.js";
import type { RenderStore } from "../render/store.js";
import type { BriefStore } from "../brief/store.js";
import { Refusal } from "../mcp/registry.js";
import { DRAFTS_PER_IDEA } from "../render/service.js";
import type { TruthStore } from "../truth/store.js";
import { burstPacket, conceptsPacket, draftsPacket, ideasPacket, rankable } from "./packet.js";
import type { CriticStep, CriticStore, Ticket } from "./store.js";

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  truth: TruthStore;
  facts: FactStore;
  board: BoardService;
  critic: CriticStore;
  images: ImageStore;
  pictures: Pictures;
  renders: RenderStore;
  briefs: BriefStore;
}

/** The lowest score for the picture of a concept that the critic recommends. */
export const RECOMMEND_VISUAL_MIN = 4;

/** An outreach batch makes one ad. Its ideas are judged this many times at most; after that the brand is parked. */
export const OUTREACH_IDEA_ROUNDS = 2;

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
/** What the critic reports when it kept no idea of an outreach batch. */
const outreachRound = (rounds = 1): string =>
  rounds >= OUTREACH_IDEA_ROUNDS
    ? `Report that no idea was kept, with your reasons. This was round ${rounds} of ${OUTREACH_IDEA_ROUNDS}, the last: the main agent parks the brand with the reason (outreach_mark) and takes the next one.`
    : `Report that no idea was kept, with your reasons. This was round ${rounds} of ${OUTREACH_IDEA_ROUNDS}: the main agent writes its ideas once more (ideas_save), and one more fresh critic judges them. That round is the last.`;

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
    if (step === "concepts") {
      if (batch.kind !== "v3") throw new Refusal('Only a batch of concept ads (v3) has concepts to review. Use step "ideas" for a v1 or v2 batch.');
      if (batch.state !== "ideas") requireMove(batch, "reviewed", "critic_open");
      await this.noRoughInTheMaking(batchId);
      const { concepts, roughs, stamp } = await this.conceptsNow(batchId);
      if (concepts.length === 0) throw new Refusal("This batch has no concepts yet. The main agent saves them first (concepts_save).");
      const { pictures } = this.deps;
      const shown = await Promise.all(
        shuffled(concepts, stamp).map(async (idea) => ({
          idea,
          roughs: await Promise.all((roughs.get(idea.id) ?? []).map(async (image) => ({ imageId: image.id, viewUrl: await pictures.viewUrl(image.key) }))),
        })),
      );
      return { ...conceptsPacket(common, shown, (await this.deps.briefs.get(batchId))?.insights), ...(await critic.issue(batchId, { step, ideaIds: concepts.map((idea) => idea.id), stamp })) };
    }
    if (step === "ideas" && batch.kind === "v3") throw new Refusal('A batch of concept ads is reviewed with step "concepts".');
    const ideas = await this.judgedAt(batch, step);
    const stamp = stampOf(ideas);

    if (step === "ideas") {
      if (batch.state !== "ideas") requireMove(batch, "judged", "critic_open");
      if (ideas.length === 0) throw new Refusal("This batch has no ideas yet. The main agent saves them first (ideas_save).");
      await this.roundLeft(batch);
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

  /** A rough that is still being made is not in the packet yet: the critic waits for it, so that its review is of the whole set. */
  /** Refuses a judgement of an outreach batch's ideas beyond the limit. Asked when a packet is opened and again when its judgement comes, so packets opened together cannot pass it. */
  private async roundLeft(batch: Batch) {
    if (batch.purpose === "outreach" && (await this.deps.critic.ideaRounds(batch.id)) >= OUTREACH_IDEA_ROUNDS) {
      throw new Refusal(
        `The ideas of this outreach batch were judged ${OUTREACH_IDEA_ROUNDS} times and none was kept. That is the limit: no good ad can be made for this brand now. Park it with the reason (outreach_mark) and take the next brand.`,
      );
    }
  }

  private async noRoughInTheMaking(batchId: string) {
    const waiting = (await this.deps.renders.list(batchId)).filter((render) => render.kind === "rough" && render.status === "queued");
    if (waiting.length > 0) {
      throw new Refusal(`A rough is still being made (${waiting.map((render) => render.ideaId).join(", ")}). The main agent reads it first (render_status), and then a fresh critic looks at the whole set.`);
    }
  }

  /** The concepts of a batch and the roughs of each, with a stamp that changes when a concept or a rough is added. */
  private async conceptsNow(batchId: string) {
    const concepts = await this.deps.batches.burst(batchId);
    const roughs = new Map<string, { id: string; key: string }[]>();
    for (const image of await this.deps.images.list(batchId, "rough")) {
      if (image.ideaId) roughs.set(image.ideaId, [...(roughs.get(image.ideaId) ?? []), image]);
    }
    const seen = [...roughs.values()].flat().map((image) => image.id).sort();
    return { concepts, roughs, stamp: createHash("sha256").update(JSON.stringify([concepts, seen])).digest("hex").slice(0, 32) };
  }

  /** The newest review of the concepts, and whether a concept or a rough was added after the critic looked. */
  async conceptReviewsOf(batchId: string) {
    const saved = await this.deps.critic.conceptReviews(batchId);
    if (!saved) return undefined;
    const { concepts, roughs } = await this.conceptsNow(batchId);
    const current =
      same(saved.reviews.map((entry) => entry.ideaId), concepts.map((idea) => idea.id)) &&
      saved.reviews.every((entry) => same(entry.roughs, (roughs.get(entry.ideaId) ?? []).map((image) => image.id)) || (entry.roughs.length === 0 && !roughs.has(entry.ideaId)));
    return { ...saved, current };
  }

  /** The critic's review of every concept, from its rough. It advises: the owner sees it and chooses. */
  async reviewConcepts(batchId: string, ticket: string, reviews: Omit<ConceptReview, "roughs">[]) {
    const { batches, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (batch.kind !== "v3") throw new Refusal("Only a batch of concept ads (v3) has concepts to review.");
    if (batch.state !== "ideas") requireMove(batch, "reviewed", "concept_review_save");
    const found = await critic.read(batchId, ticket);
    if (!found || found.step !== "concepts") throw new Refusal(BAD_TICKET);
    await this.noRoughInTheMaking(batchId);
    const { roughs, stamp } = await this.conceptsNow(batchId);
    if (found.stamp !== stamp) throw new Refusal("A concept or a rough was added after this ticket was made. Start a fresh helper and call critic_open again.");
    if (!same(reviews.map((review) => review.ideaId), found.ideaIds)) throw new Refusal(`Review each concept of the packet once, and no other: ${found.ideaIds.join(", ")}.`);
    const faults = reviews.flatMap((review) => {
      if (!review.recommend) return [];
      const why = [
        ...((roughs.get(review.ideaId) ?? []).length === 0 ? ["it has no rough, so it was judged from words"] : []),
        ...(review.scores.visual < RECOMMEND_VISUAL_MIN ? [`its picture scores ${review.scores.visual}, under ${RECOMMEND_VISUAL_MIN}`] : []),
        ...(review.pointTest.passed ? [] : ["it fails the point test"]),
      ];
      return why.length > 0 ? [`${review.ideaId} cannot be recommended: ${why.join(", ")}.`] : [];
    });
    if (faults.length > 0) throw new Refusal(`The review is not saved. ${faults.join(" ")} Say what you see in the note; the owner still sees the concept.`);
    if (!(await critic.use(batchId, ticket))) throw new Refusal(BAD_TICKET);
    const saved = await critic.saveConceptReviews(
      batchId,
      reviews.map((review) => ({ ...review, roughs: (roughs.get(review.ideaId) ?? []).map((image) => image.id) })),
    );
    const moved = await batches.move(batch, "reviewed", "concept_review_save");
    const recommended = saved.reviews.filter((review) => review.recommend).map((review) => review.ideaId);
    return {
      state: moved.state,
      recommended,
      nextStep:
        recommended.length === 0
          ? "Report that no concept reaches the bar, and what is missing. The main agent tells the owner, and writes more concepts (concepts_save) unless he picks from these."
          : "Report what you recommend and why. The main agent shows the owner every concept with its rough and your notes, and he picks three (concept_pick).",
    };
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
    await this.roundLeft(batch);
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
    const saved = await critic.saveStages(batchId, picks);
    const refused = picks.filter((pick) => pick.ideaId === null);
    // An outreach batch makes one ad, so one chosen idea is enough: a refused stage starts no new round.
    const outreach = batch.purpose === "outreach";
    if (refused.length > 0 && !(outreach && chosen.length > 0)) {
      return {
        state: batch.state,
        refused: refused.map(({ stage, reason }) => ({ stage, reason })),
        nextStep: outreach
          ? outreachRound(saved.rounds)
          : "Report the refused stages and what is missing. The main agent writes more ideas for them (ideas_save with the whole burst again), and then a fresh critic chooses again.",
      };
    }
    await batches.saveIdeas(batchId, chosen, "critic");
    const moved = await batches.move(batch, "judged", "critic_select");
    return {
      state: moved.state,
      chosen: chosen.map((idea) => idea.id),
      ...(refused.length > 0 ? { refused: refused.map(({ stage, reason }) => ({ stage, reason })) } : {}),
      nextStep: outreach
        ? "Report the ideas you chose, with your reasons. The main agent takes the one it is most sure of and goes on; it starts no other critic for the ideas."
        : "Report the three ideas you chose, with your reasons. The main agent shows the owner their words and waits for his yes (copy_approve).",
    };
  }

  /** The critic's keep or cut for each idea. A batch whose ideas are all kept is judged. */
  async pick(batchId: string, ticket: string, verdicts: IdeaVerdict[]) {
    const { batches, critic } = this.deps;
    const batch = await batches.get(batchId);
    if (hasWords(batch.kind)) throw new Refusal("A batch with words has a burst of ideas, and the critic chooses one for each funnel stage: use critic_select.");
    if (batch.state !== "ideas") requireMove(batch, "judged", "critic_pick");
    await this.ticket(batch, ticket, "ideas", verdicts.map((verdict) => verdict.ideaId));
    await this.roundLeft(batch);
    if (!(await critic.use(batchId, ticket))) throw new Refusal(BAD_TICKET);
    const saved = await critic.saveVerdicts(batchId, verdicts);
    const cut = verdicts.filter((verdict) => verdict.verdict === "cut");
    const kept = verdicts.filter((verdict) => verdict.verdict === "keep").map((verdict) => verdict.ideaId);
    // An outreach batch makes one ad, so one kept idea is enough: a cut idea starts no new round.
    const outreach = batch.purpose === "outreach";
    if (cut.length > 0 && !(outreach && kept.length > 0)) {
      return {
        state: batch.state,
        cut: cut.map(({ ideaId, reason }) => ({ ideaId, reason })),
        nextStep: outreach
          ? outreachRound(saved.rounds)
          : "Report the cut ideas and your reasons. The main agent writes a new idea in place of each one (ideas_save with all three), and then a fresh critic judges again.",
      };
    }
    if (cut.length > 0) await batches.saveIdeas(batchId, (await batches.ideas(batchId)).filter((idea) => kept.includes(idea.id)), "critic");
    const moved = await batches.move(batch, "judged", "critic_pick");
    return {
      state: moved.state,
      ...(cut.length > 0 ? { kept, cut: cut.map(({ ideaId, reason }) => ({ ideaId, reason })) } : {}),
      nextStep: outreach
        ? "Report the ideas you kept, with your reasons. The main agent takes the one it is most sure of and goes on; it starts no other critic for the ideas."
        : "Report that the three ideas are kept, with your reasons. The main agent now sends one draft to read its price.",
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
      nextStep: "Report that the drafts are ranked, and whether any draft of each idea meets the bar. Do not tell the main agent or the owner your order: the owner picks first. The state checked means that every draft has its checks and its rank; it is no verdict on the drafts.",
    };
  }
}
