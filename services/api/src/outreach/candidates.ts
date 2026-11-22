import type { Batch, Board, BoardDraft, OutreachCandidate, OutreachCandidates, ProspectFile } from "@a11-wild/shared";
import { hasWords } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import { defectOf, rejected } from "../checks/store.js";
import { Refusal } from "../mcp/registry.js";
import { candidatesWait, owedByAgent, owedNow, refusedDrafts, stageOf, TAKES_NO_AD } from "./stage.js";
import type { OutreachStore } from "./store.js";

/** The states of a batch whose drafts are all made and checked. */
const SHOWN: Batch["state"][] = ["checked", "waiting_pick", "finals", "finished", "done"];
/** The states in which the words of an idea can still change: before any final is made. */
const WORDS_OPEN: Batch["state"][] = ["checked", "waiting_pick"];
/** The stages at which a brand takes no ad, so nothing is chosen for it. */
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
    const refused = refusedDrafts(file, batch.id);
    const drafts: OutreachCandidate[] = board.ideas.flatMap(({ idea, copy, drafts: made }) =>
      made.map((draft) => {
        const blocked =
          blockedBy(draft) ??
          (hasWords(batch.kind) && !draft.words ? "Its words are not set yet." : undefined) ??
          (draft.words && !draft.words.checks?.looked ? "Its words are not checked yet." : undefined) ??
          (refused.has(draft.image.id) ? "You said no to its full-size version." : undefined);
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
    const owed = owedNow(file, optOuts);
    const mine = owed?.batchId === batch.id ? owed : undefined;
    const picked = file.events.filter((event) => event.type === "pick" && event.batchId === batch.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    return {
      batchId: batch.id,
      words: hasWords(batch.kind) && WORDS_OPEN.includes(batch.state),
      waits: candidatesWait(file)?.batchId === batch.id,
      agentOwes: mine !== undefined,
      choosing: TAKES_NO_AD.includes(stageOf(file, optOuts)) ? "closed" : mine?.type === "words" ? "agent" : "open",
      ...(picked?.type === "pick" ? { picked: { ideaId: picked.ideaId, imageId: picked.imageId } } : {}),
      ...(mine?.type === "words" ? { wordsAsked: { imageId: mine.imageId, ownerSaid: mine.ownerSaid } } : {}),
      drafts,
    };
  }

  /**
   * The agent's last step before the owner's pick: it puts the checked drafts of an outreach batch on the prospect's page.
   * Called again after other words were set, it shows the drafts as they are now.
   */
  async show(batchId: string): Promise<{ drafts: number; canBePicked: number; already: boolean; note: string }> {
    const batch = await this.deps.batches.get(batchId);
    if (batch.purpose !== "outreach" || !batch.prospectId) throw new Refusal("This is not an outreach batch. Only the drafts of a batch that was started for a prospect are shown on its page.");
    if (!SHOWN.includes(batch.state)) throw new Refusal(`This batch is "${batch.state}". Its drafts are shown when each one is made, checked and carries its words.`);
    const { file, optOuts } = await this.file(batch.prospectId);
    const view = await this.view(file, optOuts);
    if (!view || view.batchId !== batch.id) throw new Refusal("A newer outreach batch of this brand has drafts. Only the newest is shown.");
    const board = await this.deps.board.board(batch.id);
    if (view.choosing === "closed") throw new Refusal(`This brand is at "${stageOf(file, optOuts)}": it takes no ad now.`);
    const asked = owedByAgent(file);
    if (asked?.type === "words" && asked.batchId === batch.id) {
      // He asked for other words: the drafts go back to him only when that draft carries words he has not seen.
      const copy = board.ideas.find(({ idea }) => idea.id === asked.ideaId)?.copy;
      const draft = view.drafts.find((entry) => entry.imageId === asked.imageId);
      if (!copy || copy.at <= asked.at || !draft || draft.blocked) {
        throw new Refusal(
          `The owner asked for other words on draft ${asked.imageId} of ${asked.ideaId}: "${asked.ownerSaid}". Save the new words of that idea with copy_approve, set them on its drafts with type_set, look at each one (checks_save), and then show the drafts again.`,
        );
      }
    }
    const canBePicked = view.drafts.filter((draft) => !draft.blocked).length;
    if (canBePicked === 0) throw new Refusal("No draft of this batch can be sent: each has a D item, two F items or no words. Repair them with one more round of pictures at most, or park the brand with outreach_mark.");
    const counts = { drafts: view.drafts.length, canBePicked };
    const note = "The drafts wait for the owner's pick on the prospect's page. Stop work on this brand: pick nothing and make no final. outreach_next names it again when he has chosen.";
    const waiting = candidatesWait(file);
    // Shown already and nothing has changed since: a second call adds no second line to the owner's list.
    if (waiting?.batchId === batch.id || (asked?.type === "pick" && asked.batchId === batch.id)) return { ...counts, already: true, note };
    await this.deps.store.addEvent(file.profile.id, { type: "candidates", batchId: batch.id, drafts: canBePicked }, "agent");
    return { ...counts, already: false, note };
  }

  /** The drafts the owner may choose from now, or a refusal that says why he may not. */
  private async open(prospectId: string, imageId?: string) {
    const { file, optOuts } = await this.file(prospectId);
    const view = await this.view(file, optOuts);
    if (!view) throw new Refusal("The studio has no drafts for this brand yet.");
    if (view.choosing === "closed") throw new Refusal("This brand takes no ad now, so none is chosen for it.");
    if (view.choosing === "agent") throw new Refusal("The agent is setting the other words you asked for. The drafts come back for your pick after that.");
    const draft = imageId ? view.drafts.find((entry) => entry.imageId === imageId) : undefined;
    if (imageId && !draft) throw new Refusal("That picture is not one of this brand's drafts.");
    if (draft?.blocked) throw new Refusal(`This draft cannot be sent: ${draft.blocked}`);
    return { file, view, draft };
  }

  /** The owner's pick of the one draft to send. The agent then makes its final; the pick can change until the first message is sent. */
  async pick(prospectId: string, imageId: string, by: string): Promise<void> {
    const { file, view, draft } = await this.open(prospectId, imageId);
    if (!draft) throw new Refusal("Name the draft to send.");
    if (view.picked?.imageId === imageId && owedByAgent(file)?.type === "pick") return;
    await this.deps.board.ownerPick(view.batchId, { ideaId: draft.ideaId, imageId }, by);
    // Drafts made before this page showed them were never marked as shown. They are now, so a no to the final brings him back to them.
    if (!file.events.some((event) => event.type === "candidates" && event.batchId === view.batchId)) {
      await this.deps.store.addEvent(file.profile.id, { type: "candidates", batchId: view.batchId, drafts: view.drafts.filter((entry) => !entry.blocked).length }, "agent");
    }
    await this.deps.store.addEvent(file.profile.id, { type: "pick", batchId: view.batchId, ideaId: draft.ideaId, imageId }, "owner");
  }

  /** The owner wants none of the drafts. It counts as a no, and the agent's next try reads his words. */
  async none(prospectId: string, ownerSaid: string): Promise<void> {
    const { file, view } = await this.open(prospectId);
    if (!ownerSaid.trim()) throw new Refusal("Say in one line why none of them is right. The agent reads it for the next try.");
    const shown = candidatesWait(file);
    if (shown?.batchId !== view.batchId) throw new Refusal("These drafts do not wait for your pick now. To drop an ad that is made, say \"Not this after all\" on it first.");
    // One no for one showing of the drafts: two clicks at one moment do not use up both tries.
    const mark = `none-${shown.id}`;
    if (!(await this.deps.store.once(file.profile.id, mark))) return;
    try {
      await this.deps.store.addEvent(file.profile.id, { type: "none", batchId: view.batchId, ownerSaid: ownerSaid.trim() }, "owner");
    } catch (error) {
      // His no was not saved: the mark goes back, so that his next click saves it.
      await this.deps.store.giveBack(file.profile.id, mark).catch(() => undefined);
      throw error;
    }
  }

  /** The owner wants one draft with other words. The agent sets them and shows the drafts again. */
  async words(prospectId: string, imageId: string, ownerSaid: string): Promise<void> {
    const { file, view, draft } = await this.open(prospectId, imageId);
    if (!draft) throw new Refusal("Name the draft whose words change.");
    if (!view.words) throw new Refusal("The words of these drafts cannot change now: the ad has none, or its full-size version is made. Say \"None of these\" with what the words should say.");
    if (!ownerSaid.trim()) throw new Refusal("Say in one line what the words should say.");
    await this.deps.store.addEvent(file.profile.id, { type: "words", batchId: view.batchId, ideaId: draft.ideaId, imageId, ownerSaid: ownerSaid.trim() }, "owner");
  }
}
