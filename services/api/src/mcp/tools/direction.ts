import { z } from "zod";
import { type BatchState, DRAFT_AXES, LOCKUPS, RISKS } from "@a11-wild/shared";
import { requireMove, stepAfter } from "../../batch/state.js";
import type { BatchStore } from "../../batch/store.js";
import type { CopyStore } from "../../copy/store.js";
import { AXES_APART_MIN, directionFaults, type DirectionStore, samePlan } from "../../direction/store.js";
import { DRAFTS_PER_IDEA } from "../../render/service.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

export interface DirectionToolDeps {
  batches: BatchStore;
  copy: CopyStore;
  directions: DirectionStore;
  /** Says when the drafts of a concept did not pass, redo included. */
  drafts: { spent(batchId: string, ideaId: string): Promise<boolean> };
}

const id = z.string().min(1).max(64);
const line = (max: number) => z.string().min(1).max(max);
const DRAFTING: readonly BatchState[] = ["priced", "waiting_spend", "drafting"];
const NOT_V3 = "Only a batch of concept ads (v3) has a direction. A v1 or v2 batch goes from its ideas to its drafts.";

export function directionTools({ batches, copy, directions, drafts }: DirectionToolDeps): ToolDefinition[] {
  return [
    defineTool({
      name: "direction_save",
      description: `Saves the direction of a batch of concept ads (v3), after the owner's yes to the words and before any draft: one direction for each picked concept. Once drafts are made it is taken again for one reason only: a draft of a concept was made again and its checks reject the redo too. Then send every concept, the others as they are (direction_get), and that concept with a lower risk (a concept at low: a plainer look); its three drafts start again. It says why the look says the concept, how hard the picture is to make right, what the ${DRAFTS_PER_IDEA} drafts share, where the words stand, and the ${DRAFTS_PER_IDEA} drafts. Each draft asks the owner one question (for example "pack held, or pack alone?") and answers ${DRAFT_AXES.length} axes in a few plain words each. Each pair of drafts differs on ${AXES_APART_MIN} axes or more, and one of them is composition, camera or scale: three drafts that differ only in light are one picture three times. The stage is the brand's own colour unless the concept needs a place. A save is a new version.`,
      input: {
        batchId: id,
        concepts: z
          .array(
            z.strictObject({
              ideaId: id,
              since: z.number().int().optional().describe("As direction_get gave it. The studio sets it; what you send is not used."),
              why: line(600).describe("Why this look says the concept."),
              risk: z.enum(RISKS).describe("How hard the picture is for the model to make right: a held or opened product, a hand, a liquid and many items are high."),
              riskReason: line(400).optional().describe("Needed for high: why the concept is worth the risk, and what the lower-risk way is."),
              look: line(600).describe("What the three drafts share: the stage, the colour, the light."),
              lockup: z.enum(LOCKUPS).describe("Where the words stand: a column flush left, a column flush right, or a band at the top with the words on its left. It follows the picture, not a habit."),
              drafts: z
                .array(
                  z.strictObject({
                    number: z.number().int().optional().describe("As direction_get gave it. The drafts are numbered in the order sent."),
                    question: line(200).describe("The one question this draft asks the owner."),
                    axes: z.strictObject(Object.fromEntries(DRAFT_AXES.map((axis) => [axis, line(200)])) as Record<(typeof DRAFT_AXES)[number], z.ZodString>),
                  }),
                )
                .length(DRAFTS_PER_IDEA),
            }),
          )
          .min(1)
          .max(3),
      },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, concepts }, context) => {
        const batch = await batches.get(batchId);
        if (batch.kind !== "v3") throw new Refusal(NOT_V3);
        // Once drafts are being made, the direction changes only to lower the risk of a concept whose drafts did not pass.
        const drafting = DRAFTING.includes(batch.state);
        if (batch.state !== "directed" && !drafting) requireMove(batch, "directed", "direction_save");
        const ideas = await batches.ideas(batchId);
        const approved = await copy.list(batchId);
        const unworded = ideas.filter((idea) => !approved.some((words) => words.ideaId === idea.id)).map((idea) => idea.id);
        if (unworded.length > 0) throw new Refusal(`The owner has not said yes to the words of ${unworded.join(", ")} (copy_approve). A direction is for a concept whose words are approved.`);
        const sent = concepts.map((concept) => concept.ideaId);
        const stray = sent.find((ideaId) => !ideas.some((idea) => idea.id === ideaId));
        if (stray) throw new Refusal(`${stray} is not a concept the owner picked. He picked ${ideas.map((idea) => idea.id).join(", ")}.`);
        const missing = ideas.filter((idea) => !sent.includes(idea.id)).map((idea) => idea.id);
        if (new Set(sent).size !== sent.length || missing.length > 0) {
          throw new Refusal(`Give one direction for each picked concept, each once.${missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : ""}`);
        }
        const unreasoned = concepts.filter((concept) => concept.risk === "high" && !concept.riskReason?.trim()).map((concept) => concept.ideaId);
        if (unreasoned.length > 0) throw new Refusal(`${unreasoned.join(", ")}: a high risk needs its reason: why the concept is worth it, and what the lower-risk way is.`);
        const numbered = concepts.map(({ riskReason, drafts, since: _since, ...concept }) => ({
          ...concept,
          ...(riskReason ? { riskReason } : {}),
          drafts: drafts.map((draft, index) => ({ ...draft, number: index + 1 })),
        }));
        const faults = numbered.flatMap(directionFaults);
        if (faults.length > 0) throw new Refusal(`The direction is not saved. ${faults.join(" ")}`);
        if (drafting) {
          const current = await directions.get(batchId);
          const changed = numbered.filter((concept) => {
            const earlier = current?.concepts.find((other) => other.ideaId === concept.ideaId);
            return earlier && !samePlan(earlier, concept);
          });
          const early: string[] = [];
          for (const concept of changed) if (!(await drafts.spent(batchId, concept.ideaId))) early.push(concept.ideaId);
          if (early.length > 0) {
            throw new Refusal(`The drafts of this direction are being made. The direction of a concept changes only after a draft of it was made again and its checks reject the redo too: not ${early.join(", ")}. Send the other concepts as they are (direction_get).`);
          }
          // A concept that is at low already takes a plainer look at low.
          const raised = changed.filter((concept) => {
            const was = RISKS.indexOf(current!.concepts.find((other) => other.ideaId === concept.ideaId)!.risk);
            return RISKS.indexOf(concept.risk) > was || (was > 0 && RISKS.indexOf(concept.risk) === was);
          });
          if (raised.length > 0) {
            throw new Refusal(`After its drafts did not pass, the direction of a concept changes only to a lower risk: ${raised.map((concept) => `${concept.ideaId} stays at ${concept.risk} or goes up`).join("; ")}.`);
          }
        }
        const saved = await directions.save(batchId, numbered, context.user.email);
        const moved = batch.state === "directed" || drafting ? batch : await batches.move(batch, "directed", "direction_save");
        return { state: moved.state, direction: saved, nextStep: stepAfter(moved) };
      },
    }),
    defineTool({
      name: "direction_get",
      description: "Returns the direction of a batch of concept ads (v3): for each picked concept its look, its risk, where the words stand and its three drafts, each with its question and its axes. Free.",
      input: { batchId: id },
      handler: async ({ batchId }) => {
        const batch = await batches.get(batchId);
        if (batch.kind !== "v3") throw new Refusal(NOT_V3);
        return { direction: (await directions.get(batchId)) ?? null };
      },
    }),
  ];
}
