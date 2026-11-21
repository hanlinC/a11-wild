import { z } from "zod";
import { hasWords, requireMove } from "../../batch/state.js";
import type { BatchStore } from "../../batch/store.js";
import type { BrandStore } from "../../brand/store.js";
import type { CopyStore } from "../../copy/store.js";
import type { FactStore } from "../../facts/store.js";
import { wordFaults } from "../../ideas/checks.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const line = (max: number) => z.string().min(1).max(max);

/** The states in which the owner can still change the words: before any final is made. */
const OPEN_FOR_WORDS = ["judged", "worded", "directed", "priced", "waiting_spend", "drafting", "checked", "waiting_pick"];

export function copyTools({ batches, brands, facts, copy }: { batches: BatchStore; brands: BrandStore; facts: FactStore; copy: CopyStore }): ToolDefinition[] {
  return [
    defineTool({
      name: "copy_approve",
      description:
        'Saves the owner\'s yes to the words of the ideas of a batch with words, before any draft is made. Show him each idea with its headline and subline as text (and at most one other headline, marked as an option), and wait for his answer. Save the words exactly as he approved them, with his spelling, case and punctuation, and his answer in ownerSaid. The first call covers every idea of the batch. A later call changes the words of one idea, on his say only; its pictures then get their words set again. Refused: a number that is in no fact of the idea\'s claims, and a price, saving or delivery offer on a top-of-funnel ad. A line over the length guide is saved with a note, because his own words stand over the guide. Free.',
      input: {
        batchId: id,
        ideas: z
          .array(
            z.strictObject({
              ideaId: id,
              headline: line(120).describe('The headline he approved. " | " forces a line break when it is set.'),
              subline: line(120),
              footnote: line(160).optional().describe("The source line of a claim from a study."),
              ownerSaid: line(1000).describe("His answer, in his own words."),
            }),
          )
          .min(1)
          .max(3),
      },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, ideas: approved }, context) => {
        if (context.user.role !== "owner") throw new Refusal("Only the owner approves the words.");
        const batch = await batches.get(batchId);
        if (!hasWords(batch.kind)) throw new Refusal("A v1 picture carries the logo and no words, so there are no words to approve.");
        if (!OPEN_FOR_WORDS.includes(batch.state)) requireMove(batch, "worded", "copy_approve");
        const ideas = await batches.ideas(batchId);
        const ids = approved.map((entry) => entry.ideaId);
        if (new Set(ids).size !== ids.length) throw new Refusal("Give each idea once.");
        const stray = ids.find((ideaId) => !ideas.some((idea) => idea.id === ideaId));
        if (stray) throw new Refusal(`This batch has no idea ${stray}. Its ideas: ${ideas.map((idea) => idea.id).join(", ")}.`);
        if (batch.state === "judged" && ids.length !== ideas.length) {
          throw new Refusal(`The first approval covers every idea of the batch: ${ideas.map((idea) => idea.id).join(", ")}.`);
        }

        const saved = await facts.list((await brands.product(batch.productId)).id);
        const notes: string[] = [];
        for (const entry of approved) {
          const idea = ideas.find((candidate) => candidate.id === entry.ideaId);
          const proof = saved.filter((fact) => idea?.claims?.some((claim) => claim.factId === fact.id));
          const { length, truth } = wordFaults({ headline: entry.headline, subline: entry.subline, ...(entry.footnote ? { footnote: entry.footnote } : {}), ...(idea?.stage ? { stage: idea.stage } : {}) }, proof);
          if (truth.length > 0) throw new Refusal(`The words of ${entry.ideaId} are not saved: ${truth.join("; ")}. Tell the owner, and save words that the facts hold.`);
          notes.push(...length.map((fault) => `${entry.ideaId}: ${fault}. His words stand; tell him the count.`));
        }
        const words = [];
        for (const { footnote, ...entry } of approved) words.push(await copy.approve(batchId, { ...entry, ...(footnote ? { footnote } : {}), by: context.user.email }));
        const moved = batch.state === "judged" ? await batches.move(batch, "worded", "copy_approve") : batch;
        return {
          state: moved.state,
          approved: words,
          ...(notes.length > 0 ? { notes } : {}),
          nextStep: batch.state === "judged" ? "Make the drafts: the model paints no words. Then set these words on each draft with type_set." : "Set the new words on this idea's pictures again with type_set and look at each one (checks_save). The rank of the old pictures no longer counts: a fresh critic ranks them again before the owner picks.",
        };
      },
    }),
  ];
}
