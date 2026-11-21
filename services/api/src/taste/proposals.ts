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
    if (input.approve) {
      const current = (await this.canon.get(proposal.scope)).version;
      if (current !== proposal.baseVersion) {
        throw new Refusal(`The canon of ${scopeName(proposal.scope)} changed since proposal ${proposal.id} was written (version ${proposal.baseVersion}, now ${current}). Approving it would drop that change. Decline it and propose again from the current canon.`);
      }
    }
    // Two decisions at the same moment: only the first one counts.
    if (!(await this.table.put({ pk: PK, sk: `D#${proposal.id}`, by: input.by }, { ifNotExists: true }))) throw new Refusal(`Proposal ${proposal.id} is being decided.`);
    let canon: CanonVersion | undefined;
    try {
      if (input.approve) canon = await this.canon.save({ scope: proposal.scope, text: proposal.text, reason: `${proposal.reason} (proposal ${proposal.id}; the owner said: "${ownerSaid}")`, by: input.by });
    } catch (error) {
      await this.table.delete(PK, `D#${proposal.id}`);
      throw error;
    }
    const decided: CanonProposal = { ...proposal, status: input.approve ? "approved" : "declined", decidedAt: this.now().toISOString(), ownerSaid, ...(canon ? { version: canon.version } : {}) };
    await this.table.put({ pk: PK, sk: sk(proposal.id), ...decided });
    return { proposal: decided, ...(canon ? { canon } : {}) };
  }
}
