import { z } from "zod";
import { FUNNEL_STAGES } from "@a11-wild/shared";
import type { Calibration } from "../../critic/calibration.js";
import type { CriticService } from "../../critic/service.js";
import { TICKET_MINUTES } from "../../critic/store.js";
import { DRAFTS_PER_IDEA } from "../../render/service.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const ticket = z.string().min(1).max(100).describe("The ticket that critic_open gave. It works once.");
const reason = z.string().min(10).max(600);

export function criticTools({ critic, calibration }: { critic: CriticService; calibration: Calibration }): ToolDefinition[] {
  return [
    defineTool({
      name: "critic_open",
      description: `The blind critic's first call. Free. Only a fresh helper calls it: a new agent that was given the batch id and nothing else, not the session that wrote the ideas or made the drafts. step "ideas" gives the batch's three ideas to judge, after ideas_save. step "drafts" gives each idea's ${DRAFTS_PER_IDEA} finished drafts to rank, for the ideas the owner has not chosen for yet. The packet holds no owner pick, no earlier rank and none of the author's notes, and a ticket for one critic_pick or one critic_rank within ${TICKET_MINUTES} minutes. If you cannot start a fresh helper, send freshHelper false: the studio then says what to tell the owner.`,
      input: {
        batchId: id,
        step: z.enum(["ideas", "drafts"]),
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
