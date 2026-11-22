import type { Batch, BatchKind, BatchState, BatchWaitsFor } from "@a11-wild/shared";
import type { GateStage } from "../spend/gate.js";
import { hasWords, teachesNothing } from "./state.js";

/** Where a batch stands for a person who reads the dashboard: who acts next, and on what. */
export interface BatchWait {
  who: BatchWaitsFor;
  text: string;
  /** The owner answers his agent in chat. */
  chat?: true;
}

type Of = Pick<Batch, "kind" | "state" | "test" | "purpose">;

/** What the stores hold about a batch that its state does not say. Each is read only where it can make the owner wait. */
export interface BatchFacts {
  /** The stage whose estimate has no yes of the owner's yet. */
  spend?: GateStage;
  /** The ideas with no pick and no pass of the owner's. */
  picksLeft?: number;
  /** An ad has Meta text that was saved after the owner's last yes to that ad's text. */
  meta?: boolean;
}

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
  reviewed: "The agent reads the critic's review.",
  judged: "The agent reads the price of the drafts.",
  worded: "The agent reads the price of the drafts.",
  directed: "The agent reads the price of the drafts.",
  priced: "The agent makes the drafts.",
  waiting_spend: "The agent makes the drafts.",
  drafting: "The agent checks the drafts, and a blind critic ranks them.",
  checked: "The agent sets up the pick board.",
  waiting_pick: "The agent makes the finals.",
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

/** The stages whose cost can wait for a yes at each state. The estimate of a stage the batch has left is no question any more. */
const SPEND_AT: Partial<Record<BatchState, readonly GateStage[]>> = {
  intake: ["research"],
  truth: ["research"],
  briefed: ["research", "roughs"],
  ideas: ["research", "roughs"],
  reviewed: ["roughs"],
  judged: ["drafts"],
  worded: ["drafts"],
  directed: ["drafts"],
  priced: ["drafts"],
  waiting_spend: ["drafts"],
  drafting: ["drafts"],
  waiting_pick: ["finals"],
  finals: ["finals"],
};

/** The stages to read the estimate of: one that waits for a yes is the batch's `spend`. Only a concept ad has roughs. */
export const spendStagesOf = (batch: Of): readonly GateStage[] =>
  teachesNothing(batch) ? [] : (SPEND_AT[batch.state] ?? []).filter((stage) => stage !== "roughs" || batch.kind === "v3");

/** The states in which a pick can be owed. The batch stays at the board after the last pick, and goes to its finals at the first final. */
const PICKING: readonly BatchState[] = ["waiting_pick", "finals"];
export const mayWaitForPick = (batch: Of): boolean => PICKING.includes(batch.state) && !teachesNothing(batch);

/** The states in which a batch has picked ads, so its Meta text can wait for the owner. */
const PICKED: readonly BatchState[] = ["finals", "finished", "done"];
export const mayWaitForMeta = (batch: Of): boolean => PICKED.includes(batch.state) && !teachesNothing(batch);

/** The states at which the next step is a choice. In a test batch and an outreach batch another makes it. */
const choiceAt = ({ kind, state }: Of): boolean =>
  (state === "reviewed" && kind === "v3") || (state === "judged" && hasWords(kind)) || state === "waiting_spend" || state === "waiting_pick";

/** What the owner is asked for. The cost comes first: nothing else of the batch moves until he answers it. */
function ownerStep({ kind, state }: Of, facts: BatchFacts): BatchWait | undefined {
  if (facts.spend) return { who: "owner", text: `Say yes or no to the cost of the ${facts.spend}.`, chat: true };
  if (state === "reviewed" && kind === "v3") return { who: "owner", text: "Pick three concepts." };
  if (state === "judged" && hasWords(kind)) return { who: "owner", text: "Say yes or no to the words.", chat: true };
  if (PICKING.includes(state) && facts.picksLeft) return { who: "owner", text: "Pick one draft for each idea." };
  if (PICKED.includes(state) && facts.meta) return { who: "owner", text: "Say yes or no to the Meta text.", chat: true };
  return undefined;
}

/**
 * Who a batch waits for. In a test batch and in an outreach batch another chooses in the owner's place, so neither ever waits for him.
 * The state alone does not say it: a batch stays at the board after the last pick and at the estimate after the yes, until the agent goes on.
 */
export function waitOf(batch: Of, facts: BatchFacts): BatchWait {
  if (batch.state === "spec_only") return { who: "nobody", text: AGENT.spec_only };
  const asked = teachesNothing(batch) ? undefined : ownerStep(batch, facts);
  if (asked) return asked;
  if (batch.state === "done") return { who: "nobody", text: AGENT.done };
  // The draft of an outreach ad is the owner's own pick, on the brand's page: Outreach counts it, so the batch asks nothing here.
  if (batch.purpose === "outreach" && batch.state === "waiting_pick") return { who: "nobody", text: "Its drafts are on the brand's page in Outreach. You pick there." };
  if (teachesNothing(batch) && choiceAt(batch)) return { who: "agent", text: batch.test ? "A test: the tester chooses in your place." : "The agent chooses in your place." };
  return { who: "agent", text: agentStep(batch.kind, batch.state) };
}
