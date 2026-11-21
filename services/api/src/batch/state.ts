import type { BatchState } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";

/** What must be done to reach each state: the words a refusal gives the agent. */
const STEP: Record<BatchState, string> = {
  intake: "choose a saved brand and product (batch_create)",
  truth: "save the product's truth sheet (truth_save)",
  ideas: "save three ideas (ideas_save)",
  judged: 'the blind pick, by a fresh helper that gets the batch id only: critic_open with step "ideas", then critic_pick',
  priced: "send one draft to read its price",
  waiting_spend: "the owner's yes to the estimate (spend_approve)",
  drafting: "make the drafts",
  checked: 'save the shape and print checks of every draft, and have a fresh helper rank each idea\'s drafts blind (critic_open with step "drafts", then critic_rank)',
  waiting_pick: "show the board to the owner",
  finals: "the owner's pick of one draft for each idea",
  finished: "make the finals and pass their pack, cap and finish checks",
  done: "pass the done gate (batch_done)",
  spec_only: "save the text spec (spec_save)",
};

/** The states that follow each state. `waiting_spend` is skipped when the estimate is under the gate. */
const NEXT: Record<BatchState, BatchState[]> = {
  intake: ["truth"],
  truth: ["ideas"],
  ideas: ["judged", "spec_only"],
  judged: ["priced"],
  priced: ["waiting_spend", "drafting"],
  waiting_spend: ["drafting"],
  drafting: ["checked"],
  checked: ["waiting_pick"],
  waiting_pick: ["finals"],
  finals: ["finished"],
  // A finished batch goes back to its finals when one of them gets a D item or a repair after the fact.
  finished: ["done", "finals"],
  // A final that gets a D item after the batch was done takes it back to its finals.
  done: ["finals"],
  spec_only: [],
};

export class StateError extends Refusal {}

/** The order of the picture path, to tell how far a batch has come. */
const PATH: BatchState[] = ["intake", "truth", "ideas", "judged", "priced", "waiting_spend", "drafting", "checked", "waiting_pick", "finals", "finished", "done"];

/** The first step still to do before a batch can reach `wanted`, or nothing when the move is allowed. */
export function missingStep(from: BatchState, wanted: BatchState): string | undefined {
  if (NEXT[from].includes(wanted)) return undefined;
  if (from === "spec_only") return "nothing: this batch ended with a text spec, and the studio does not render its format";
  const next = NEXT[from][0];
  if (wanted === "spec_only" || !next) return STEP[wanted];
  // A move backwards or sideways is named by the step the caller asked for.
  if (PATH.indexOf(wanted) <= PATH.indexOf(from)) return `nothing: the batch is already at ${from}`;
  return STEP[next];
}

/** Refuses a tool that belongs to a later state, and names the step that is missing. */
export function requireMove(from: BatchState, wanted: BatchState, tool: string): void {
  const missing = missingStep(from, wanted);
  if (!missing) return;
  if (from !== "spec_only" && PATH.indexOf(wanted) <= PATH.indexOf(from)) throw new StateError(`${tool} cannot run now: its step is over, and the batch is already at "${from}".`);
  throw new StateError(`${tool} cannot run yet: the batch is at "${from}". The step that is missing: ${missing}.`);
}

/** What the agent does next from a state, for a session that resumes a batch. */
export const stepAfter = (state: BatchState): string => {
  const next = state === "done" ? undefined : NEXT[state][0];
  return next ? STEP[next] : "nothing: the batch is at its end";
};
