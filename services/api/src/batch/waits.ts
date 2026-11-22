import type { Batch, BatchKind, BatchState, BatchWaitsFor } from "@a11-wild/shared";
import { hasWords, teachesNothing } from "./state.js";

/** Where a batch stands for a person who reads the dashboard: who acts next, and on what. */
export interface BatchWait {
  who: BatchWaitsFor;
  text: string;
  /** The owner answers his agent in chat. */
  chat?: true;
}

type Of = Pick<Batch, "kind" | "state" | "test" | "purpose">;

/** A batch of concept ads opens on its concepts until its drafts are made. */
const CONCEPT_STATES: readonly BatchState[] = ["truth", "briefed", "ideas", "reviewed", "judged", "worded", "directed"];

/** The dashboard page of a batch. */
export const pageOf = ({ id, kind, state }: Pick<Batch, "id" | "kind" | "state">): string =>
  kind === "v3" && CONCEPT_STATES.includes(state) ? `/batches/${id}/concepts` : `/batches/${id}`;

/** What the agent does from each state, in the words of a reader and not of a tool. */
const AGENT: Record<BatchState, string> = {
  intake: "The agent writes the truth sheet.",
  truth: "The agent writes the ideas.",
  briefed: "The agent writes the concepts.",
  ideas: "A blind critic judges the ideas.",
  reviewed: "The agent chooses in your place.",
  judged: "The agent reads the price of the drafts.",
  worded: "The agent reads the price of the drafts.",
  directed: "The agent reads the price of the drafts.",
  priced: "The agent makes the drafts.",
  waiting_spend: "The agent chooses in your place.",
  drafting: "The agent checks the drafts, and a blind critic ranks them.",
  checked: "The agent sets up the pick board.",
  waiting_pick: "The agent chooses in your place.",
  finals: "The agent makes the finals.",
  finished: "The agent checks the finals against the done gate.",
  done: "Done.",
  spec_only: "Ended with a text spec: the studio does not render this format.",
};

const AGENT_V3: Partial<Record<BatchState, string>> = {
  truth: "The agent writes the brief.",
  ideas: "A blind critic reviews the concepts.",
  worded: "The agent writes the direction of each concept.",
};

const agentStep = (kind: BatchKind, state: BatchState): string => (kind === "v3" ? AGENT_V3[state] : undefined) ?? AGENT[state];

/** What the owner is asked for, at the states where a batch waits for him. */
function ownerStep({ kind, state }: Of): BatchWait | undefined {
  if (state === "reviewed" && kind === "v3") return { who: "owner", text: "Pick three concepts." };
  if (state === "judged" && hasWords(kind)) return { who: "owner", text: "Say yes or no to the words.", chat: true };
  if (state === "waiting_spend") return { who: "owner", text: "Say yes or no to the cost of the drafts.", chat: true };
  if (state === "waiting_pick") return { who: "owner", text: "Pick one draft for each idea." };
  return undefined;
}

/** The states in which a batch has picked ads, so its Meta text can wait for the owner. */
const PICKED: readonly BatchState[] = ["finals", "finished", "done"];
export const mayWaitForMeta = (batch: Of): boolean => PICKED.includes(batch.state) && !teachesNothing(batch);

/**
 * Who a batch waits for. In a test batch and in an outreach batch another chooses in the owner's place, so neither ever waits for him.
 * `metaWaits` says that an ad of the batch has Meta text and no version the owner approved.
 */
export function waitOf(batch: Of, metaWaits = false): BatchWait {
  if (batch.state === "spec_only") return { who: "nobody", text: AGENT.spec_only };
  if (!teachesNothing(batch)) {
    const asked = ownerStep(batch);
    if (asked) return asked;
    if (metaWaits && mayWaitForMeta(batch)) return { who: "owner", text: "Say yes or no to the Meta text.", chat: true };
  }
  if (batch.state === "done") return { who: "nobody", text: AGENT.done };
  if (ownerStep(batch)) return { who: "agent", text: batch.test ? "A test: the tester chooses in your place." : "The agent chooses in your place." };
  return { who: "agent", text: agentStep(batch.kind, batch.state) };
}
