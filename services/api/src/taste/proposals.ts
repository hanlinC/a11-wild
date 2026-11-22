import { randomUUID } from "node:crypto";
import type { CanonProposal, CanonScope, CanonVersion } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";
import { CANON_MAX_CHARS, type CanonStore, scopeName } from "./canon.js";
import type { LearningStore } from "./learning.js";

const PK = "CANONPROPOSAL";
const sk = (id: string) => `P#${id}`;
/** A lesson for every brand rests on more than one sighting: one correction makes no rule for every brand. */
export const EVIDENCE_FOR_EVERY_BRAND = 2;
export const PROPOSALS_OPEN_MAX = 20;

/** The owner's yes or no, as it was first given. */
interface Decision {
  approve: boolean;
  ownerSaid: string;
  by: string;
  at: string;
}

/** Changes to a canon that wait for the owner. A proposal is words on a shelf: no batch reads it until he approves it. */
export class ProposalStore {
  constructor(
    private readonly table: Table,
    private readonly canon: CanonStore,
    private readonly learning: LearningStore,
    private readonly now: () => Date,
  ) {}

  async list(): Promise<CanonProposal[]> {
    const items = await this.table.query<Item & CanonProposal>(PK);
    return items
      .filter((item) => item.sk.startsWith("P#"))
      .map((item) => record<CanonProposal>(item))
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt) || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<CanonProposal> {
    const item = await this.table.get<Item & CanonProposal>(PK, sk(id));
    if (!item) throw new Refusal(`There is no proposal ${id}.`);
    return record<CanonProposal>(item);
  }

  async propose(input: { scope: CanonScope; text: string; reason: string; recordIds: string[]; by: string }): Promise<CanonProposal> {
    const text = input.text.trim();
    const reason = input.reason.trim();
    if (!text || !reason) throw new Refusal("A proposal needs the whole canon as it would read, and a reason.");
    if (text.length > CANON_MAX_CHARS) throw new Refusal(`The canon is longer than ${CANON_MAX_CHARS} characters. Cut it: a short canon gets read.`);
    const recordIds = [...new Set(input.recordIds)];
    const records = await Promise.all(recordIds.map((id) => this.learning.get(id)));
    const { scope } = input;
    const stray = records.filter((entry) => entry.scope.kind !== scope.kind || (scope.kind === "brand" && entry.scope.brandId !== scope.brandId));
    if (stray.length > 0) {
      throw new Refusal(`Records ${stray.map((entry) => entry.id).join(", ")} are not about ${scopeName(scope)}. A lesson stays in the scope it was seen in.`);
    }
    const evidence = records.reduce((sum, entry) => sum + entry.evidence, 0);
    if (scope.kind !== "brand" && evidence < EVIDENCE_FOR_EVERY_BRAND) {
      throw new Refusal(`One correction makes no rule for every brand. A change to ${scopeName(scope)} rests on ${EVIDENCE_FOR_EVERY_BRAND} sightings or more; these records hold ${evidence}. Keep the record, or propose it for the one brand.`);
    }
    if ((await this.list()).filter((proposal) => proposal.status === "proposed").length >= PROPOSALS_OPEN_MAX) {
      throw new Refusal(`${PROPOSALS_OPEN_MAX} proposals already wait for the owner. Ask him to decide those first.`);
    }
    const proposal: CanonProposal = {
      id: randomUUID().slice(0, 8),
      scope,
      text,
      reason,
      recordIds,
      baseVersion: (await this.canon.get(scope)).version,
      status: "proposed",
      proposedBy: input.by,
      proposedAt: this.now().toISOString(),
    };
    await this.table.put({ pk: PK, sk: sk(proposal.id), ...proposal });
    return proposal;
  }

  /** The owner's yes or no. A yes makes the next version of that canon; a no keeps the proposal as a record. */
  async decide(input: { id: string; approve: boolean; ownerSaid: string; by: string }): Promise<{ proposal: CanonProposal; canon?: CanonVersion }> {
    const proposal = await this.get(input.id);
    const ownerSaid = input.ownerSaid.trim();
    if (!ownerSaid) throw new Refusal("A decision needs the owner's own words.");
    if (proposal.status !== "proposed") throw new Refusal(`Proposal ${proposal.id} is already ${proposal.status}.`);
    const marker = `D#${proposal.id}`;
    const started = await this.table.get<Item & Decision>(PK, marker);
    // A decision that stopped half way is finished, not made again: its yes may already be the canon.
    if (input.approve && !started) {
      const current = (await this.canon.get(proposal.scope)).version;
      if (current !== proposal.baseVersion) {
        throw new Refusal(`The canon of ${scopeName(proposal.scope)} changed since proposal ${proposal.id} was written (version ${proposal.baseVersion}, now ${current}). Approving it would drop that change. Decline it and propose again from the current canon.`);
      }
    }
    // The decision is written down first, so two at the same moment are one, and one that stopped half way is finished by the next try.
    let decision: Decision = { approve: input.approve, ownerSaid, by: input.by, at: this.now().toISOString() };
    if (!(await this.table.put({ pk: PK, sk: marker, ...decision }, { ifNotExists: true }))) {
      const earlier = started ?? (await this.table.get<Item & Decision>(PK, marker));
      if (!earlier) throw new Refusal(`Proposal ${proposal.id} is being decided. Try again.`);
      if (earlier.approve !== input.approve) throw new Refusal(`Proposal ${proposal.id} already has the owner's ${earlier.approve ? "yes" : "no"}. It is being saved.`);
      decision = record<Decision>(earlier);
    }
    let canon: CanonVersion | undefined;
    if (decision.approve) {
      const reason = `${proposal.reason} (proposal ${proposal.id}; the owner said: "${decision.ownerSaid}")`;
      try {
        // Only on top of the version it was written against: two proposals approved at the same moment cannot both land.
        canon = await this.canon.save({ scope: proposal.scope, text: proposal.text, reason, by: decision.by, after: proposal.baseVersion });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        // An earlier try of this same decision may have saved it already.
        const next = (await this.canon.versions(proposal.scope)).find((entry) => entry.version === proposal.baseVersion + 1);
        if (next?.reason !== reason) {
          await this.table.delete(PK, marker);
          throw error;
        }
        canon = await this.canon.version(next.version, proposal.scope);
      }
    }
    const decided: CanonProposal = {
      ...proposal,
      status: decision.approve ? "approved" : "declined",
      decidedAt: decision.at,
      ownerSaid: decision.ownerSaid,
      ...(canon ? { version: canon.version } : {}),
    };
    await this.table.put({ pk: PK, sk: sk(proposal.id), ...decided });
    return { proposal: decided, ...(canon ? { canon } : {}) };
  }
}
