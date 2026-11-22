import { CONCEPT_SCORES, type ConceptPick, type ConceptReview, type Idea, type Role } from "@a11-wild/shared";
import { requireMove, teachesNothing } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import type { BriefStore } from "../brief/store.js";
import type { CriticService } from "../critic/service.js";
import { type Item, record, type Table } from "../store/table.js";
import { Refusal } from "../mcp/registry.js";
import type { TasteLog } from "../taste/log.js";

/** The number of concepts the owner picks. They can be of any funnel stage. */
export const CONCEPTS_PICKED = 3;

/** A score under this is a soft gate: the pick is saved, and the owner is told. */
const SCORE_MIN = 4;
const low = (review: ConceptReview) => CONCEPT_SCORES.filter((score) => review.scores[score] < SCORE_MIN);

const SK = "CONCEPT_PICK";
const TEST_PICK = "This is a test batch: the pick is saved for the batch only. It is not in the taste log.";
const OUTREACH_PICK = "This is an outreach batch: the pick is the agent's, saved for the batch only. It is not in the taste log.";

interface Deps {
  table: Table;
  now: () => Date;
  batches: BatchStore;
  brands: BrandStore;
  briefs: BriefStore;
  critic: CriticService;
  tasteLog: TasteLog;
}

export interface ConceptPickInput {
  picks: { ideaId: string; ownerSaid: string }[];
  passes?: { ideaId: string; ownerSaid: string }[];
}

/** The owner's pick of three concepts from the whole set. Only he makes it; the critic's review is advice. */
export class ConceptPicks {
  constructor(private readonly deps: Deps) {}

  async get(batchId: string): Promise<ConceptPick | undefined> {
    const item = await this.deps.table.get<Item & ConceptPick>(`BATCH#${batchId}`, SK);
    return item && record<ConceptPick>(item);
  }

  async save(batchId: string, input: ConceptPickInput, user: { email: string; role: Role }) {
    const { table, now, batches, brands, briefs, critic, tasteLog } = this.deps;
    if (user.role !== "owner") throw new Refusal("Only the owner picks the concepts.");
    const batch = await batches.get(batchId);
    if (batch.kind !== "v3") throw new Refusal("Only a batch of concept ads (v3) has concepts to pick.");
    // He can change his pick until he has approved the words.
    if (batch.state !== "judged") requireMove(batch, "judged", "concept_pick");
    const picks = input.picks.map((pick) => ({ ideaId: pick.ideaId, ownerSaid: pick.ownerSaid.trim() }));
    const passes = (input.passes ?? []).map((pass) => ({ ideaId: pass.ideaId, ownerSaid: pass.ownerSaid.trim() }));
    if ([...picks, ...passes].some((entry) => !entry.ownerSaid)) throw new Refusal("A pick or a pass is saved with the owner's own words. Ask him, and send what he said.");
    if (picks.length !== CONCEPTS_PICKED) throw new Refusal(`The owner picks ${CONCEPTS_PICKED} concepts. He gave ${picks.length}.`);
    const ids = [...picks, ...passes].map((entry) => entry.ideaId);
    if (new Set(ids).size !== ids.length) throw new Refusal("Give each concept once: as a pick, or as a pass.");
    const concepts = await batches.burst(batchId);
    const stray = ids.find((ideaId) => !concepts.some((idea) => idea.id === ideaId));
    if (stray) throw new Refusal(`This batch has no concept ${stray}.`);
    const reviews = await critic.conceptReviewsOf(batchId);
    if (!reviews?.current) {
      throw new Refusal('The critic has not seen every concept and rough as they are now. A fresh helper reviews them first (critic_open with step "concepts"), and the owner sees its notes before he picks.');
    }

    const chosen = picks.map((pick) => concepts.find((idea) => idea.id === pick.ideaId) as Idea);
    const brief = await briefs.get(batchId);
    const warnings = chosen.flatMap((idea) => {
      const review = reviews.reviews.find((entry) => entry.ideaId === idea.id);
      const guess = brief?.insights.find((insight) => insight.id === idea.concept?.insightId)?.basis === "hypothesis";
      return [
        ...(review && review.roughs.length === 0 ? [`${idea.id} has no rough: he picked it from its words.`] : []),
        ...(review && !review.recommend ? [`The critic did not recommend ${idea.id}: ${review.note}`] : []),
        ...(review && !review.pointTest.passed ? [`${idea.id} fails the point test: ${review.pointTest.note}`] : []),
        ...(review && low(review).length > 0 ? [`The critic scored ${idea.id} under ${SCORE_MIN} of 5 for ${low(review).join(", ")}.`] : []),
        ...(guess ? [`${idea.id} stands on a hypothesis, not on what a buyer said.`] : []),
      ];
    });

    const before = await this.get(batchId);
    const saved: ConceptPick = { picks, passes, warnings, by: user.email, at: now().toISOString() };
    await table.put({ pk: `BATCH#${batchId}`, sk: SK, ...saved });
    await batches.saveIdeas(batchId, chosen, user.email);
    const moved = batch.state === "judged" ? batch : await batches.move(batch, "judged", "concept_pick");
    const result = {
      state: moved.state,
      picked: chosen.map((idea) => ({ id: idea.id, title: idea.title, stage: idea.stage, headline: idea.headline, subline: idea.subline })),
      ...(warnings.length > 0 ? { warnings } : {}),
      nextStep: "Show the owner the words of the three concepts as text, and wait for his yes (copy_approve). His pick of a concept is not his yes to its words.",
    };
    if (teachesNothing(batch)) return { ...result, note: batch.test ? TEST_PICK : OUTREACH_PICK };

    const brand = await brands.brand(batch.brandId);
    const product = await brands.product(batch.productId);
    const said = (list: { ideaId: string; ownerSaid: string }[] | undefined, ideaId: string) => list?.find((entry) => entry.ideaId === ideaId)?.ownerSaid;
    for (const [kind, list, old] of [["pick", picks, before?.picks], ["pass", passes, before?.passes]] as const) {
      for (const entry of list) {
        // The same words on the same concept are in the log already.
        if (said(old, entry.ideaId) === entry.ownerSaid) continue;
        const idea = concepts.find((candidate) => candidate.id === entry.ideaId) as Idea;
        await tasteLog.add({
          kind,
          ownerSaid: entry.ownerSaid,
          about: `${brand.name}, ${product.name}. Concept "${idea.title}": ${idea.headline ?? ""} ${kind === "pick" ? `Picked as one of ${CONCEPTS_PICKED} from ${concepts.length} concepts.` : "Passed on the concept."}`,
          batchId,
          ideaId: idea.id,
          savedBy: user.email,
        });
      }
    }
    return result;
  }
}
