import { z } from "zod";
import { CONCEPT_SCORES, type ConceptScore, FUNNEL_STAGES } from "@a11-wild/shared";
import type { Calibration } from "../../critic/calibration.js";
import { type CriticService, RECOMMEND_VISUAL_MIN } from "../../critic/service.js";
import { TICKET_MINUTES } from "../../critic/store.js";
import { DRAFTS_PER_IDEA } from "../../render/service.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const ticket = z.string().min(1).max(100).describe("The ticket that critic_open gave. It works once.");
const reason = z.string().min(10).max(600);
const test = z.strictObject({ passed: z.boolean(), note: z.string().min(1).max(400).describe("One line on why.") });

export function criticTools({ critic, calibration }: { critic: CriticService; calibration: Calibration }): ToolDefinition[] {
  return [
    defineTool({
      name: "critic_open",
      description: `The blind critic's first call. Free. Only a fresh helper calls it: a new agent that was given the batch id and nothing else, not the session that wrote the ideas or made the drafts. step "ideas" gives the batch's three ideas to judge, after ideas_save. step "drafts" gives each idea's ${DRAFTS_PER_IDEA} finished drafts to rank, for the ideas the owner has not chosen for yet. The packet holds no owner pick, no earlier rank and none of the author's notes, and a ticket for one critic_pick or one critic_rank within ${TICKET_MINUTES} minutes. If you cannot start a fresh helper, send freshHelper false: the studio then says what to tell the owner.`,
      input: {
        batchId: id,
        step: z.enum(["ideas", "concepts", "drafts"]).describe('"concepts": the concepts of a v3 batch, each with its roughs as pictures, after concepts_save.'),
        freshHelper: z.boolean().describe("True only when you are a new helper that got the batch id and nothing else."),
      },
      writes: true,
      handler: ({ batchId, step, freshHelper }) => critic.open(batchId, step, freshHelper),
    }),
    defineTool({
      name: "critic_pick",
      description:
        "The blind critic's judgement of the batch's three ideas: keep or cut for each, with a reason. It needs the ticket of critic_open with step \"ideas\". All three kept: the batch is judged and its drafts can be made. One cut: the batch stays at its ideas, and the main agent writes another in its place.",
      input: {
        batchId: id,
        ticket,
        ideas: z.array(z.strictObject({ ideaId: id, verdict: z.enum(["keep", "cut"]), reason: reason.describe("Why, in a line or two.") })).min(1).max(10),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ticket, ideas }) => critic.pick(batchId, ticket, ideas),
    }),
    defineTool({
      name: "critic_select",
      description:
        "The blind critic's choice from a burst of ideas with words (a v2 batch): one idea for each of tof, mof and bof, with a reason. It needs the ticket of critic_open with step \"ideas\". Give ideaId null to refuse a stage when none of its ideas reaches the owner's bar: the main agent then writes more, and the bar is not lowered. All three chosen: the batch is judged, and the owner approves the words next.",
      input: {
        batchId: id,
        ticket,
        picks: z.array(z.strictObject({ stage: z.enum(FUNNEL_STAGES), ideaId: id.nullable(), reason: reason.describe("Why this idea, or what the stage is missing.") })).length(3),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ticket, picks }) => critic.select(batchId, ticket, picks),
    }),
    defineTool({
      name: "concept_review_save",
      description: `The fresh critic's review of every concept of a v3 batch, in one call. It needs the ticket of critic_open with step "concepts". Look at each rough as a picture, at phone size, beside the owner's reference ads (references_get). For each concept: nine scores from 1 to 5, your own point test, local-truth test and cover test from the rough, the pay question, a note, and whether you recommend it. You cannot recommend a concept with no rough, with a picture under ${RECOMMEND_VISUAL_MIN}, or one that fails the point test. You may recommend none. Your notes are shown to the owner beside each concept: he chooses, you advise.`,
      input: {
        batchId: id,
        ticket,
        reviews: z
          .array(
            z.strictObject({
              ideaId: id,
              scores: z.strictObject(Object.fromEntries(CONCEPT_SCORES.map((name) => [name, z.number().int().min(1).max(5)])) as Record<ConceptScore, z.ZodNumber>),
              pointTest: test.describe("The headline points at something the picture shows."),
              localTruth: test.describe("A buyer in Singapore lives this moment."),
              coverTest: test.describe("With the words covered, the rough still says the idea."),
              wouldPay: z.boolean().describe("Would the owner pay for this ad from his own pocket and be proud of it, beside his reference ads?"),
              recommend: z.boolean(),
              note: reason.describe("What you see, and what would make it better."),
            }),
          )
          .min(1)
          .max(30),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ticket, reviews }) => critic.reviewConcepts(batchId, ticket, reviews),
    }),
    defineTool({
      name: "critic_rank",
      description:
        "The blind critic's order of each idea's drafts, best first, with a reason for each place. It needs the ticket of critic_open with step \"drafts\", and it covers every idea of that packet. The order is kept from the owner and from the main agent until the owner has picked: the board shows it only then. A batch is checked only when each idea's drafts are ranked.",
      input: {
        batchId: id,
        ticket,
        ranks: z
          .array(z.strictObject({ ideaId: id, order: z.array(z.strictObject({ imageId: id, reason: reason.describe("Why it stands at this place.") })).min(1).max(10).describe("The idea's drafts, best first.") }))
          .min(1)
          .max(10),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ticket, ranks }) => critic.rank(batchId, ticket, ranks),
    }),
    defineTool({
      name: "calibration_report",
      description:
        "Does the blind critic agree with the owner? Free. How often the owner picked the draft that the critic had put first, and the place of each draft he picked, over every batch. Only a rank made before his pick counts. A share of fewer than 30 picks shows a direction only.",
      input: {},
      handler: () => calibration.report(),
    }),
  ];
}
