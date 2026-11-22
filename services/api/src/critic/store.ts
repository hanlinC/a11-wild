import { createHash, randomBytes } from "node:crypto";
import type { CriticRank, IdeaVerdict, StagePick, ConceptReview, ConceptReviews } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const ticketSk = (ticket: string) => `TICKET#${createHash("sha256").update(ticket).digest("hex")}`;
const VERDICTS_SK = "CRITIC#IDEAS";
const STAGES_SK = "CRITIC#STAGES";
const CONCEPTS_SK = "CRITIC#CONCEPTS";
const OPEN = "open";

/** A critic has this long to judge after it opens a packet. */
export const TICKET_MINUTES = 120;

export type CriticStep = "ideas" | "concepts" | "drafts";

export interface Ticket {
  step: CriticStep;
  /** The ideas the packet showed. */
  ideaIds: string[];
  /** A mark of the ideas as they were when the packet was made. A judgement of other ideas is not theirs. */
  stamp: string;
  /** The pictures a drafts packet showed, by draft. A repair made later shows another picture. */
  shown?: Record<string, string>;
  until: string;
}

export interface SavedStages {
  picks: StagePick[];
  at: string;
  /** How many times a critic has judged the ideas of this batch, this one counted. */
  rounds?: number;
}

export interface SavedVerdicts {
  verdicts: IdeaVerdict[];
  at: string;
  rounds?: number;
}

/** What a blind critic was given leave to judge, and what it said. */
export class CriticStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Makes a ticket for one judgement. Only its hash is kept, so the table cannot give a ticket back. */
  async issue(batchId: string, input: Omit<Ticket, "until">): Promise<{ ticket: string; until: string }> {
    const ticket = randomBytes(24).toString("base64url");
    const until = new Date(this.now().getTime() + TICKET_MINUTES * 60_000);
    await this.table.put({ pk: pk(batchId), sk: ticketSk(ticket), ...input, until: until.toISOString(), state: OPEN, expiresAt: Math.floor(until.getTime() / 1000) + 3600 });
    return { ticket, until: until.toISOString() };
  }

  /** The ticket, while it is unused and in time. */
  async read(batchId: string, ticket: string): Promise<Ticket | undefined> {
    const item = await this.table.get<Item & Ticket>(pk(batchId), ticketSk(ticket));
    if (!item || item.state !== OPEN || item.until <= this.now().toISOString()) return undefined;
    const { step, ideaIds, stamp, shown, until } = item;
    return { step, ideaIds, stamp, ...(shown ? { shown } : {}), until };
  }

  /** Spends the ticket. False when another call spent it first. */
  use(batchId: string, ticket: string): Promise<boolean> {
    return this.table.delete(pk(batchId), ticketSk(ticket), { ifEquals: { attribute: "state", value: OPEN } });
  }

  /** How many times a critic has judged the ideas of this batch. A judgement saved before the count was kept is one. */
  async ideaRounds(batchId: string): Promise<number> {
    const saved = (await this.verdicts(batchId)) ?? (await this.stages(batchId));
    return saved ? (saved.rounds ?? 1) : 0;
  }

  async saveVerdicts(batchId: string, verdicts: IdeaVerdict[]): Promise<SavedVerdicts> {
    const saved: SavedVerdicts = { verdicts, at: this.now().toISOString(), rounds: (await this.ideaRounds(batchId)) + 1 };
    await this.table.put({ pk: pk(batchId), sk: VERDICTS_SK, ...saved });
    return saved;
  }

  /** The newest judgement of the batch's ideas. */
  async verdicts(batchId: string): Promise<SavedVerdicts | undefined> {
    const item = await this.table.get<Item & SavedVerdicts>(pk(batchId), VERDICTS_SK);
    return item && record<SavedVerdicts>(item);
  }

  async saveStages(batchId: string, picks: StagePick[]): Promise<SavedStages> {
    const saved: SavedStages = { picks, at: this.now().toISOString(), rounds: (await this.ideaRounds(batchId)) + 1 };
    await this.table.put({ pk: pk(batchId), sk: STAGES_SK, ...saved });
    return saved;
  }

  /** The newest choice of one idea for each funnel stage. */
  async stages(batchId: string): Promise<SavedStages | undefined> {
    const item = await this.table.get<Item & SavedStages>(pk(batchId), STAGES_SK);
    return item && record<SavedStages>(item);
  }

  async saveConceptReviews(batchId: string, reviews: ConceptReview[]): Promise<ConceptReviews> {
    const saved: ConceptReviews = { reviews, at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: CONCEPTS_SK, ...saved });
    return saved;
  }

  /** The newest review of the batch's concepts. */
  async conceptReviews(batchId: string): Promise<ConceptReviews | undefined> {
    const item = await this.table.get<Item & ConceptReviews>(pk(batchId), CONCEPTS_SK);
    return item && record<ConceptReviews>(item);
  }

  async saveRank(batchId: string, rank: Omit<CriticRank, "at">): Promise<CriticRank> {
    const saved: CriticRank = { ...rank, at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: `RANK#${rank.ideaId}`, ...saved });
    return saved;
  }

  /** The rank of each idea's drafts, by idea. */
  async ranks(batchId: string): Promise<Map<string, CriticRank>> {
    const items = await this.table.query<Item & CriticRank>(pk(batchId));
    return new Map(items.filter((item) => item.sk.startsWith("RANK#")).map((item) => [item.ideaId, record<CriticRank>(item)]));
  }
}
