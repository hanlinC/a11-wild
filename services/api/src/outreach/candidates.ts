import type { Batch, Board, BoardDraft, OutreachCandidate, OutreachCandidates, ProspectFile } from "@a11-wild/shared";
import { hasWords } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import { defectOf, rejected } from "../checks/store.js";
import { Refusal } from "../mcp/registry.js";
import { owedByAgent, stageOf } from "./stage.js";
import type { OutreachStore } from "./store.js";

/** The states of a batch whose drafts are all made and checked. */
const SHOWN: Batch["state"][] = ["checked", "waiting_pick", "finals", "finished", "done"];
/** The stages at which the owner still chooses the ad of the first message. */
const CHOOSING = ["new", "pick_waits", "pick_made", "ad_waits", "ready"];

interface Deps {
  store: OutreachStore;
  batches: Pick<BatchStore, "list" | "get">;
  board: {
    board(batchId: string): Promise<Board>;
    ownerPick(batchId: string, input: { ideaId: string; imageId: string }, by: string): Promise<unknown>;
  };
}

/** Why a draft cannot go to a person: a D item, or two F items, in the picture or in the picture with its words. */
export function blockedBy(draft: Pick<BoardDraft, "checks" | "words">): string | undefined {
  for (const checks of [draft.checks ?? undefined, draft.words?.checks ?? undefined]) {
    const defect = defectOf(checks);
    if (defect) return defect.note;
    if (rejected(checks)) return "It has two or more faults.";
  }
  return undefined;
}

/** The owner's own choice of the ad for a prospect: he sees every draft the studio made and picks one. */
export class OutreachPicks {
  constructor(private readonly deps: Deps) {}

  /** The prospect's newest outreach batch whose drafts are ready. */
  private async batchOf(prospectId: string): Promise<Batch | undefined> {
    // The list is newest first.
    return (await this.deps.batches.list()).find((batch) => batch.purpose === "outreach" && batch.prospectId === prospectId && SHOWN.includes(batch.state));
  }

  private async file(prospectId: string): Promise<{ file: ProspectFile; optOuts: ReadonlySet<string> }> {
    const [files, optOuts] = await Promise.all([this.deps.store.all(), this.deps.store.optOuts()]);
    const file = files.find((entry) => entry.profile.id === prospectId);
    if (!file) throw new Refusal(`There is no prospect ${prospectId}.`);
    return { file, optOuts };
  }

  /** Every draft of the newest batch, as the owner would send it. Nothing when the brand has no drafts. */
  async view(file: ProspectFile, optOuts: ReadonlySet<string>): Promise<OutreachCandidates | undefined> {
    const batch = await this.batchOf(file.profile.id);
    if (!batch) return undefined;
    const board = await this.deps.board.board(batch.id);
    const drafts: OutreachCandidate[] = board.ideas.flatMap(({ idea, copy, drafts: made }) =>
      made.map((draft) => {
        const blocked = blockedBy(draft) ?? (hasWords(batch.kind) && !draft.words ? "Its words are not set yet." : undefined);
        return {
          ideaId: idea.id,
          title: idea.title,
          ...(copy ? { headline: copy.headline, subline: copy.subline } : {}),
          number: draft.number,
          imageId: draft.image.id,
          viewUrl: draft.words?.viewUrl ?? draft.viewUrl,
          ...(blocked ? { blocked } : {}),
        };
      }),
    );
    if (drafts.length === 0) return undefined;
    const owed = owedByAgent(file);
    const mine = owed?.batchId === batch.id ? owed : undefined;
    const picked = file.events.filter((event) => event.type === "pick" && event.batchId === batch.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    return {
      batchId: batch.id,
      words: hasWords(batch.kind),
      choosing: !CHOOSING.includes(stageOf(file, optOuts)) || file.sends.some((send) => send.step === 0) ? "closed" : mine?.type === "words" ? "agent" : "open",
      ...(picked?.type === "pick" ? { picked: { ideaId: picked.ideaId, imageId: picked.imageId } } : {}),
      ...(mine?.type === "words" ? { wordsAsked: { imageId: mine.imageId, ownerSaid: mine.ownerSaid } } : {}),
      drafts,
    };
  }

  /** The drafts the owner may choose from now, or a refusal that says why he may not. */
  private async open(prospectId: string, imageId?: string) {
    const { file, optOuts } = await this.file(prospectId);
    const view = await this.view(file, optOuts);
    if (!view) throw new Refusal("The studio has no drafts for this brand yet.");
    if (view.choosing === "closed") throw new Refusal("The first message is sent, or this brand takes no ad now. The ad is not chosen again.");
    const draft = imageId ? view.drafts.find((entry) => entry.imageId === imageId) : undefined;
    if (imageId && !draft) throw new Refusal("That picture is not one of this brand's drafts.");
    if (draft?.blocked) throw new Refusal(`This draft cannot be sent: ${draft.blocked}`);
    return { file, view, draft };
  }

  /** The owner's pick of the one draft to send. The agent then makes its final; the pick can change until the first message is sent. */
  async pick(prospectId: string, imageId: string, by: string): Promise<void> {
    const { file, view, draft } = await this.open(prospectId, imageId);
    if (!draft) throw new Refusal("Name the draft to send.");
    await this.deps.board.ownerPick(view.batchId, { ideaId: draft.ideaId, imageId }, by);
    await this.deps.store.addEvent(file.profile.id, { type: "pick", batchId: view.batchId, ideaId: draft.ideaId, imageId }, "owner");
  }

  /** The owner wants none of the drafts. It counts as a no, and the agent's next try reads his words. */
  async none(prospectId: string, ownerSaid: string): Promise<void> {
    const { file, view } = await this.open(prospectId);
    if (!ownerSaid.trim()) throw new Refusal("Say in one line why none of them is right. The agent reads it for the next try.");
    await this.deps.store.addEvent(file.profile.id, { type: "none", batchId: view.batchId, ownerSaid: ownerSaid.trim() }, "owner");
  }

  /** The owner wants one draft with other words. The agent sets them and shows the drafts again. */
  async words(prospectId: string, imageId: string, ownerSaid: string): Promise<void> {
    const { file, view, draft } = await this.open(prospectId, imageId);
    if (!draft) throw new Refusal("Name the draft whose words change.");
    if (!view.words) throw new Refusal("This ad has no words to change.");
    if (!ownerSaid.trim()) throw new Refusal("Say in one line what the words should say.");
    await this.deps.store.addEvent(file.profile.id, { type: "words", batchId: view.batchId, ideaId: draft.ideaId, imageId, ownerSaid: ownerSaid.trim() }, "owner");
  }
}
