import { type ConceptDirection, type Direction, DRAFT_AXES, type DraftAxis, type DraftPlan, MAIN_AXES } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const SK = "DIRECTION";

/** The fewest axes on which two drafts of one concept differ. */
export const AXES_APART_MIN = 3;

const plain = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** The axes on which two drafts say something else. */
const planOf = ({ since: _since, ...plan }: ConceptDirection) => JSON.stringify(plan, Object.keys(plan).sort());
/** True when two directions of a concept say the same. */
export const samePlan = (a: ConceptDirection, b: ConceptDirection): boolean =>
  planOf({ ...a, drafts: [] }) === planOf({ ...b, drafts: [] }) && JSON.stringify(a.drafts.map((draft) => [draft.number, draft.question, DRAFT_AXES.map((axis) => draft.axes[axis])])) === JSON.stringify(b.drafts.map((draft) => [draft.number, draft.question, DRAFT_AXES.map((axis) => draft.axes[axis])]));

export const axesApart = (a: DraftPlan, b: DraftPlan): DraftAxis[] => DRAFT_AXES.filter((axis) => plain(a.axes[axis]) !== plain(b.axes[axis]));

/**
 * The countable facts of a direction: each pair of drafts differs on three axes or more, and on
 * composition, camera or scale. Three drafts that differ only in light are one picture three times.
 */
export function directionFaults(concept: Pick<ConceptDirection, "ideaId" | "drafts">): string[] {
  const faults: string[] = [];
  for (const [index, a] of concept.drafts.entries()) {
    for (const b of concept.drafts.slice(index + 1)) {
      const apart = axesApart(a, b);
      const pair = `${concept.ideaId}: drafts ${a.number} and ${b.number}`;
      if (apart.length < AXES_APART_MIN) faults.push(`${pair} differ on ${apart.length} of ${DRAFT_AXES.length} axes (${apart.join(", ") || "none"}). They differ on ${AXES_APART_MIN} or more.`);
      else if (!apart.some((axis) => MAIN_AXES.includes(axis))) faults.push(`${pair} differ on ${apart.join(", ")}, and on none of ${MAIN_AXES.join(", ")}. One of those changes too.`);
    }
  }
  return faults;
}

/** The direction of a batch of concept ads. Every version stays, so a draft is traced to the direction it was made from. */
export class DirectionStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async get(batchId: string): Promise<Direction | undefined> {
    const item = await this.table.get<Item & Direction>(pk(batchId), SK);
    return item && record<Direction>(item);
  }

  async version(batchId: string, version: number): Promise<Direction | undefined> {
    const item = await this.table.get<Item & Direction>(pk(batchId), `${SK}#${version}`);
    return item && record<Direction>(item);
  }

  async save(batchId: string, concepts: ConceptDirection[], by: string): Promise<Direction> {
    const before = await this.get(batchId);
    const version = (before?.version ?? 0) + 1;
    // A concept whose plan is the same keeps its drafts; one whose plan changed starts again from this version.
    const dated = concepts.map((concept) => {
      const earlier = before?.concepts.find((other) => other.ideaId === concept.ideaId);
      return { ...concept, since: earlier && samePlan(earlier, concept) ? (earlier.since ?? 1) : version };
    });
    const saved: Direction = { concepts: dated, version, at: this.now().toISOString(), by };
    await this.table.put({ pk: pk(batchId), sk: `${SK}#${saved.version}`, ...saved });
    await this.table.put({ pk: pk(batchId), sk: SK, ...saved });
    return saved;
  }
}
