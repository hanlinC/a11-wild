import { type ApprovedCopy, type Batch, type BatchImage, type BatchState, type Board, type BoardDraft, type CheckItem, type Direction, FINAL_POINTS, type FinalPoints, type ImageChecks, type ImageKind, type Pick as OwnerPick, type Role } from "@a11-wild/shared";
import { hasWords } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import { failedPoints, type PointStore } from "../checks/points.js";
import { type CheckStore, defectOf, rejected } from "../checks/store.js";
import type { CopyStore } from "../copy/store.js";
import type { CriticStore } from "../critic/store.js";
import type { DirectionStore } from "../direction/store.js";
import type { ImageStore } from "../images/store.js";
import { Refusal } from "../mcp/registry.js";
import type { PickStore } from "../picks/store.js";
import type { Pictures } from "../pictures/store.js";
import { DRAFTS_PER_IDEA, type FinalRule } from "../render/service.js";
import type { RenderStore } from "../render/store.js";
import type { TasteLog } from "../taste/log.js";
import type { TruthStore } from "../truth/store.js";

/** The tool that measures a pack's shape. A product with a pack photo needs it on every draft and every final. */
export const PACK_CHECK = "pack_check";

const TEST_PICK = "This is a test batch: the pick is saved for the batch only. It is not in the taste log and not in the calibration.";

/** The states in which the owner picks. A checked batch moves to `waiting_pick` with his first pick. */
// A finished batch still takes a newer choice: the owner may pick a draft of an idea he passed on.
const PICKING: BatchState[] = ["checked", "waiting_pick", "finals", "finished"];

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  truth: TruthStore;
  images: ImageStore;
  renders: RenderStore;
  checks: CheckStore;
  picks: PickStore;
  critic: CriticStore;
  tasteLog: TasteLog;
  pictures: Pictures;
  copy: CopyStore;
  points: PointStore;
  directions: DirectionStore;
}

/** The kinds of picture that repair a draft or a final and then stand for it. */
export const REPAIR_KINDS: readonly ImageKind[] = ["reprint", "swap", "grade", "relight", "box_print"];
/** The picture that counts for a draft or a final: its newest repair, or the picture itself. */
export const countedOf = (image: BatchImage, all: BatchImage[]): BatchImage =>
  all.filter((other) => REPAIR_KINDS.includes(other.kind) && other.rootId === image.id).at(-1) ?? image;
/**
 * The picture with the approved words on it: the newest one set on this very picture with the words as they are now.
 * Words that changed since, or a repair made since, need the words set again. A picture set before the studio kept the version is told by its time.
 */
export const typesetOf = (on: BatchImage, all: BatchImage[], words: ApprovedCopy | undefined): BatchImage | undefined =>
  words
    ? all.filter((other) => other.kind === "typeset" && other.fromId === on.id && (other.wordsVersion === undefined ? other.createdAt >= words.at : other.wordsVersion === words.version)).at(-1)
    : undefined;
/** The picture the owner and the critic look at: the draft or its newest repair, and in an ad with words that picture with its words. */
export const seenOf = (draft: Pick<BoardDraft, "shown" | "words">): BatchImage => draft.words?.image ?? draft.shown;
/** The real-camera finish that was made from this very picture, the newest one. */
export const finishOf = (counted: BatchImage, all: BatchImage[]): BatchImage | undefined => all.filter((other) => other.kind === "finish" && other.fromId === counted.id).at(-1);

/** Where one idea stands on its way to a final. */
export interface IdeaFinal {
  ideaId: string;
  pick: OwnerPick | undefined;
  /** What the idea still needs. Empty when it has a clean, finished final, or the owner's pass. */
  missing: string[];
  /** The picture that is delivered, once the final lacks nothing: the finished final, and in an ad with words that picture with its words. */
  delivered?: BatchImage;
}

/** The drafts of a batch as the owner sees them, the checks that every picture needs, and the owner's picks. */
export class BoardService implements FinalRule {
  constructor(private readonly deps: Deps) {}

  /** The finished pictures of one kind, by idea, in the order they were sent. */
  private async sent(batchId: string, kind: "draft" | "final"): Promise<Map<string, BatchImage[]>> {
    const { renders, images } = this.deps;
    const byId = new Map((await images.list(batchId, kind)).map((image) => [image.id, image]));
    const byIdea = new Map<string, BatchImage[]>();
    const all = await renders.list(batchId);
    // A draft that was made again and finished: the redo stands in its place.
    const redone = new Set(all.filter((render) => render.status === "done").map((render) => render.redoOf));
    // A concept whose direction was lowered shows the drafts of its direction as it is now.
    const since = new Map(kind === "draft" ? (await this.deps.directions.get(batchId))?.concepts.map((concept) => [concept.ideaId, concept.since ?? 0]) : []);
    for (const render of all) {
      if (render.directionVersion !== undefined && render.directionVersion < (since.get(render.ideaId) ?? 0)) continue;
      const image = render.kind === kind && render.status === "done" && render.imageId && !redone.has(render.id) ? byId.get(render.imageId) : undefined;
      if (image) byIdea.set(render.ideaId, [...(byIdea.get(render.ideaId) ?? []), image]);
    }
    return byIdea;
  }

  /** For each draft of a concept ad: its number and the question it asks, from the version of the direction it was made for. */
  private async questions(batchId: string): Promise<Map<string, { number: number; question: string }>> {
    const { renders, directions } = this.deps;
    const asked = new Map<string, { number: number; question: string }>();
    const versions = new Map<number, Direction | undefined>();
    for (const render of await renders.list(batchId)) {
      if (render.kind !== "draft" || !render.imageId || render.draft === undefined || render.directionVersion === undefined) continue;
      if (!versions.has(render.directionVersion)) versions.set(render.directionVersion, await directions.version(batchId, render.directionVersion));
      const plan = versions.get(render.directionVersion)?.concepts.find((concept) => concept.ideaId === render.ideaId)?.drafts.find((draft) => draft.number === render.draft);
      if (plan) asked.set(render.imageId, { number: plan.number, question: plan.question });
    }
    return asked;
  }

  async board(batchId: string): Promise<Board> {
    const { batches, brands, truth, checks, picks, critic, pictures } = this.deps;
    const batch = await batches.get(batchId);
    const [brand, product, ideas, drafts, finals, found, picked, ranks] = await Promise.all([
      brands.brand(batch.brandId),
      brands.product(batch.productId),
      batches.ideas(batchId),
      this.sent(batchId, "draft"),
      this.sent(batchId, "final"),
      checks.all(batchId),
      picks.all(batchId),
      critic.ranks(batchId),
    ]);
    const all = await this.deps.images.list(batchId);
    const approved = hasWords(batch.kind) ? await this.deps.copy.list(batchId) : [];
    const asked = batch.kind === "v3" ? await this.questions(batchId) : new Map<string, { number: number; question: string }>();
    const shown = (list: BatchImage[] = []): Promise<BoardDraft[]> =>
      Promise.all(
        // A concept's drafts stand in the order of the direction, each with its question.
        [...list].sort((a, b) => (asked.get(a.id)?.number ?? 0) - (asked.get(b.id)?.number ?? 0)).map(async (image, index) => {
          const counted = countedOf(image, all);
          const finish = finishOf(counted, all);
          // The words go on a draft as it counts now, and on a final after its real-camera finish.
          const words = typesetOf(image.kind === "final" ? (finish ?? counted) : counted, all, approved.find((copy) => copy.ideaId === image.ideaId));
          return {
            number: asked.get(image.id)?.number ?? index + 1,
            ...(asked.has(image.id) ? { question: asked.get(image.id)!.question } : {}),
            image,
            shown: counted,
            viewUrl: await pictures.viewUrl(counted.key),
            checks: found.get(counted.id) ?? null,
            ...(finish ? { finish: { image: finish, viewUrl: await pictures.viewUrl(finish.key) } } : {}),
            ...(words ? { words: { image: words, viewUrl: await pictures.viewUrl(words.key), checks: found.get(words.id) ?? null } } : {}),
          };
        }),
      );
    return {
      batch,
      picking: PICKING.includes(batch.state) ? "open" : batch.state === "finished" || batch.state === "done" ? "closed" : "not_yet",
      brand: { id: brand.id, name: brand.name },
      product: { id: product.id, name: product.name },
      truthSheet: (await truth.get(batch.productId, batch.truthVersion)) ?? null,
      ideas: await Promise.all(
        ideas.map(async (idea) => {
          const pick = picked.find((entry) => entry.ideaId === idea.id) ?? null;
          // The critic's rank is shown only after the owner's own choice, so that it cannot lead him.
          const copy = approved.find((entry) => entry.ideaId === idea.id);
          return { idea, ...(copy ? { copy } : {}), drafts: await shown(drafts.get(idea.id)), pick, rank: pick ? (ranks.get(idea.id) ?? null) : null, finals: await shown(finals.get(idea.id)) };
        }),
      ),
    };
  }

  /** What one picture still needs before it counts as checked: the agent's look, and the pack measure when the product has a pack photo. */
  private async needs(batchId: string, image: BatchImage, hasPack: boolean, found: Map<string, ImageChecks>): Promise<string[]> {
    const missing: string[] = [];
    if (!found.get(image.id)?.looked) missing.push(`checks_save for picture ${image.id}`);
    if (hasPack && !(await this.deps.checks.measuredBy(batchId, image.id)).includes(PACK_CHECK)) missing.push(`${PACK_CHECK} for picture ${image.id}`);
    return missing;
  }

  /** What a picture with its words still needs: the agent's look at the words on it, with no D item and fewer than two F items. Setting the type again is free. */
  private wordNeeds(on: BatchImage, set: BatchImage | undefined, found: Map<string, ImageChecks>, what: string): string[] {
    if (!set) return [`type_set for picture ${on.id}: the approved words and the real logo on the ${what}`];
    const seen = found.get(set.id);
    if (!seen?.looked) return [`checks_save for picture ${set.id}: the ${what} of ${on.id} with its words`];
    const defect = defectOf(seen);
    if (defect) return [`type_set again for picture ${on.id}: with its words it has ${defect.code} (${defect.note})`];
    if (rejected(seen)) return [`type_set again for picture ${on.id}: with its words it has two F items or more`];
    return [];
  }

  /** Where each idea stands on its way to a final: the owner's choice, and what its newest final still needs. */
  async finals(batch: Batch): Promise<IdeaFinal[]> {
    const { batches, brands, checks, picks } = this.deps;
    const hasPack = (await brands.product(batch.productId)).photos.some((photo) => photo.kind === "pack");
    const [found, all, finals, made] = await Promise.all([checks.all(batch.id), this.deps.images.list(batch.id), this.sent(batch.id, "final"), picks.all(batch.id)]);
    const approved = hasWords(batch.kind) ? await this.deps.copy.list(batch.id) : [];
    const entries: IdeaFinal[] = [];
    for (const idea of await batches.ideas(batch.id)) {
      const pick = made.find((entry) => entry.ideaId === idea.id);
      const missing: string[] = [];
      const entry: IdeaFinal = { ideaId: idea.id, pick, missing };
      entries.push(entry);
      if (!pick) missing.push(`the owner's pick, or his pass, for ${idea.id}`);
      if (!pick?.imageId) continue;
      // The newest final of the picked draft is the one that counts: an earlier one was made again because it failed, and a final of a draft he no longer picks does not count.
      const newest = finals.get(idea.id)?.filter((final) => final.fromId === pick.imageId).at(-1);
      if (!newest) {
        missing.push(`a finished final of ${idea.id}, from the picked draft ${pick.imageId}`);
        continue;
      }
      // A repair of a final stands for it, and is checked again as a new picture.
      const final = countedOf(newest, all);
      missing.push(...(await this.needs(batch.id, final, hasPack, found)));
      const defect = defectOf(found.get(final.id));
      if (defect) missing.push(`a final of ${idea.id} with no D item (the newest has ${defect.code})`);
      else if (rejected(found.get(final.id))) missing.push(`a final of ${idea.id} with fewer than two F items`);
      else if (!finishOf(final, all)) missing.push(`photo_finish for picture ${final.id}`);
      else {
        const finish = finishOf(final, all) as BatchImage;
        const set = hasWords(batch.kind) ? typesetOf(finish, all, approved.find((copy) => copy.ideaId === idea.id)) : undefined;
        if (hasWords(batch.kind)) missing.push(...this.wordNeeds(final, set, found, "finished final"));
        // A concept ad is delivered only after the eight-point look at the picture the owner would send.
        if (missing.length === 0 && batch.kind === "v3" && set) {
          const seen = await this.deps.points.get(batch.id, set.id);
          const failed = seen ? failedPoints(seen) : [];
          if (!seen) missing.push(`final_points_save for picture ${set.id}: the eight points of the final of ${idea.id}, at full size and at phone size`);
          else if (failed.length > 0) missing.push(`a final of ${idea.id} that passes every point (the newest fails ${failed.join(", ")})`);
        }
        if (missing.length === 0) entry.delivered = set ?? finish;
      }
    }
    return entries;
  }

  /** Moves the batch on when every draft, or every final, is checked. Returns what is still missing. */
  async progress(batch: Batch): Promise<{ batch: Batch; missing: string[] }> {
    const { batches, brands, checks, critic } = this.deps;
    const missing: string[] = [];
    if (batch.state === "drafting") {
      const hasPack = (await brands.product(batch.productId)).photos.some((photo) => photo.kind === "pack");
      const [found, all, drafts, ranks] = await Promise.all([checks.all(batch.id), this.deps.images.list(batch.id), this.sent(batch.id, "draft"), critic.ranks(batch.id)]);
      const approved = hasWords(batch.kind) ? await this.deps.copy.list(batch.id) : [];
      for (const idea of await batches.ideas(batch.id)) {
        const mine = drafts.get(idea.id) ?? [];
        const words = approved.find((copy) => copy.ideaId === idea.id);
        if (mine.length < DRAFTS_PER_IDEA) missing.push(`${DRAFTS_PER_IDEA - mine.length} more finished draft(s) of ${idea.id}`);
        for (const image of mine) {
          const counted = countedOf(image, all);
          missing.push(...(await this.needs(batch.id, counted, hasPack, found)));
          // The owner judges an ad, not a bare photo: each draft carries the approved words and the real logo before he sees it.
          if (hasWords(batch.kind)) missing.push(...this.wordNeeds(counted, typesetOf(counted, all, words), found, "draft"));
        }
        // A rank counts while it is of the pictures the owner sees now: a repair made after it, or words set after it, needs a new rank.
        const judged = new Map(ranks.get(idea.id)?.order.map((place) => [place.imageId, place.shownId]));
        const seen = (image: BatchImage) => {
          const counted = countedOf(image, all);
          return (hasWords(batch.kind) ? typesetOf(counted, all, words) : undefined) ?? counted;
        };
        if (!mine.every((image) => judged.get(image.id) === seen(image).id)) {
          missing.push(`the blind critic's rank of the drafts of ${idea.id} as they are now (a fresh helper: critic_open with step "drafts", then critic_rank)`);
        }
      }
      if (missing.length === 0) batch = await batches.move(batch, "checked", "checks_save");
    } else if (batch.state === "finals" || batch.state === "finished" || batch.state === "done") {
      missing.push(...(await this.finals(batch)).flatMap((entry) => entry.missing));
      if (missing.length === 0 && batch.state === "finals") batch = await batches.move(batch, "finished", "checks_save");
      // A finished or done batch whose final got a D item, or a repair that is not checked yet, is not finished any more.
      else if (missing.length > 0 && batch.state !== "finals") batch = await batches.move(batch, "finals", "checks_save");
    }
    return { batch, missing };
  }

  /** Saves the agent's look at a draft or a final. */
  async saveChecks(batchId: string, imageId: string, items: Omit<CheckItem, "tool">[]) {
    const { batches, images, checks } = this.deps;
    const batch = await batches.get(batchId);
    const image = await images.get(batchId, imageId);
    if (!["draft", "final", "typeset", ...REPAIR_KINDS].includes(image.kind)) {
      throw new Refusal(`Picture ${imageId} is a ${image.kind}. Checks are saved for a draft, a final, a repair of one, or one with its words set.`);
    }
    const saved = await checks.save(batchId, imageId, items);
    const { batch: after, missing } = await this.progress(batch);
    const defect = defectOf(saved);
    return {
      checks: saved,
      state: after.state,
      ...(defect ? { note: `This picture has ${defect.code}, so it cannot become a final. It stays on the board, named with its item.` } : {}),
      ...(missing.length > 0 ? { stillMissing: missing } : {}),
    };
  }

  /** Shows the board. A batch whose drafts are all checked now waits for the owner's pick. */
  async show(batchId: string): Promise<Board> {
    const { batches } = this.deps;
    const batch = await batches.get(batchId);
    if (["intake", "truth", "ideas", "judged", "worded", "priced", "waiting_spend", "spec_only"].includes(batch.state)) {
      throw new Refusal(`The board is not ready: the batch is at "${batch.state}", and its drafts are not all made.`);
    }
    if (batch.state === "drafting") {
      const { batch: after, missing } = await this.progress(batch);
      if (after.state === "drafting") throw new Refusal(`The board is not ready: the drafts are not all checked. Still missing: ${missing.join("; ")}.`);
    }
    const now = await batches.get(batchId);
    if (now.state === "checked") await batches.move(now, "waiting_pick", "board_show");
    return this.board(batchId);
  }

  /** Saves the owner's choice for one idea, in his words, and adds it to the taste log. */
  async pick(batchId: string, input: { ideaId: string; imageId: string | null; ownerSaid: string }, user: { email: string; role: Role }) {
    const { batches, picks, tasteLog } = this.deps;
    if (user.role !== "owner") throw new Refusal("Only the owner picks a draft.");
    const ownerSaid = input.ownerSaid.trim();
    if (!ownerSaid) throw new Refusal("A pick or a pass is saved with the owner's own words. Ask him why, and send what he said.");
    let batch = await batches.get(batchId);
    if (batch.state === "checked") batch = await batches.move(batch, "waiting_pick", "pick_save");
    if (!PICKING.includes(batch.state)) {
      throw new Refusal(`The owner picks when the board is ready. This batch is at "${batch.state}".`);
    }
    const board = await this.board(batchId);
    const entry = board.ideas.find(({ idea }) => idea.id === input.ideaId);
    if (!entry) throw new Refusal(`This batch has no idea ${input.ideaId}.`);
    const draft = input.imageId ? entry.drafts.find(({ image }) => image.id === input.imageId) : undefined;
    if (input.imageId && !draft) throw new Refusal(`Picture ${input.imageId} is not a draft of ${input.ideaId}.`);
    // In an ad with words the owner chooses between ads, not bare photos: after his words change, the pictures carry them again first.
    const bare = hasWords(batch.kind) ? entry.drafts.filter((shown) => !shown.words) : [];
    if (bare.length > 0) {
      throw new Refusal(
        `The words of ${input.ideaId} are not on ${bare.length === entry.drafts.length ? "its drafts" : `draft ${bare.map((shown) => shown.number).join(", ")}`} as they are now, so the owner has not seen the ad he would choose. Set them with type_set, look at each picture (checks_save), have a fresh critic rank them again, and show him the board.`,
      );
    }

    const pick = await picks.save(batchId, { ideaId: input.ideaId, imageId: input.imageId, ...(draft ? { shownId: seenOf(draft).id } : {}), ownerSaid, by: user.email });
    // A newer choice in a finished batch names a draft with no final yet: the batch goes back to its finals.
    if (batch.state === "finished") await this.progress(batch);
    // A pick in a test batch is the tester's, not the owner's taste.
    if (batch.test) return { pick, note: TEST_PICK };
    await tasteLog.add({
      kind: draft ? "pick" : "pass",
      ownerSaid,
      about: `${board.brand.name}, ${board.product.name}. ${entry.idea.title}: ${draft ? `draft ${draft.number} of ${entry.drafts.length}` : `passed on all ${entry.drafts.length} drafts`}.`,
      batchId,
      ideaId: input.ideaId,
      ...(draft ? { draftId: draft.image.id } : {}),
      savedBy: user.email,
    });
    const defect = defectOf(draft?.checks ?? undefined) ?? defectOf(draft?.words?.checks ?? undefined);
    return { pick, ...(defect ? { note: `The picked draft has ${defect.code} (${defect.note}), so no final can be made from it. Tell the owner.` } : {}) };
  }

  /** Saves the eight-point look at the final of a concept ad as the owner would send it. A failed point keeps it out of a pack. */
  async savePoints(batchId: string, input: Pick<FinalPoints, "imageId" | "points">, by: string) {
    const { batches, images, points } = this.deps;
    const batch = await batches.get(batchId);
    if (batch.kind !== "v3") throw new Refusal("Only a final of a concept ad (v3) has the eight points.");
    const image = await images.get(batchId, input.imageId);
    const root = image.rootId ? await images.get(batchId, image.rootId) : undefined;
    if (image.kind !== "typeset" || root?.kind !== "final" || !root.ideaId) {
      throw new Refusal(`Picture ${input.imageId} is not a finished final with its words. The eight points are for the picture the owner would send: the final after photo_finish and type_set.`);
    }
    const failed = FINAL_POINTS.filter((point) => !input.points[point].passed);
    const bare = failed.filter((point) => !input.points[point].note.trim());
    if (bare.length > 0) throw new Refusal(`Say what is wrong for each failed point: ${bare.join(", ")}.`);
    const saved = await points.save(batchId, { ...input, ideaId: root.ideaId, by });
    const { batch: after, missing } = await this.progress(batch);
    return {
      points: saved,
      state: after.state,
      ...(failed.length > 0 ? { note: `This final fails ${failed.join(", ")}, so it is not delivered. Make the final again, or tell the owner.` } : {}),
      ...(missing.length > 0 ? { stillMissing: missing } : {}),
    };
  }

  /** True when a concept's drafts did not pass: one was made again, and its checks reject the redo too. */
  async spent(batchId: string, ideaId: string): Promise<boolean> {
    const [direction, renders] = await Promise.all([this.deps.directions.get(batchId), this.deps.renders.list(batchId)]);
    const since = direction?.concepts.find((concept) => concept.ideaId === ideaId)?.since ?? 0;
    const redos = renders.filter((render) => render.kind === "draft" && render.ideaId === ideaId && render.status === "done" && render.redoOf && (render.directionVersion ?? 0) >= since);
    for (const redo of redos) if (await this.rejection(batchId, redo.id)) return true;
    return false;
  }

  /** Why the checks reject a draft as it stands now (its repair stands for it), or nothing when they do not. */
  async rejection(batchId: string, imageId: string): Promise<string | undefined> {
    const { batches, images, checks, copy } = this.deps;
    const all = await images.list(batchId);
    const image = await images.get(batchId, imageId);
    const counted = countedOf(image, all);
    // A draft of an ad with words is judged with its words on: a composition that cannot hold them is rejected too.
    const words = hasWords((await batches.get(batchId)).kind) ? typesetOf(counted, all, (await copy.list(batchId)).find((entry) => entry.ideaId === image.ideaId)) : undefined;
    for (const found of [await checks.get(batchId, counted.id), words ? await checks.get(batchId, words.id) : undefined]) {
      const defect = defectOf(found);
      if (defect) return `${defect.code} (${defect.note})`;
      if (rejected(found)) return "two F items or more";
    }
    return undefined;
  }

  /** A final is made only from the draft the owner picked, and never from a draft with a D item. */
  async allow(batch: Batch, ideaId: string, draft: BatchImage): Promise<{ finals: number; source: BatchImage }> {
    const made: OwnerPick[] = await this.deps.picks.all(batch.id);
    const pick = made.find((entry) => entry.ideaId === ideaId);
    if (pick?.imageId !== draft.id) {
      throw new Refusal(
        pick?.imageId
          ? `R24: a final is made only from the draft the owner picked. For ${ideaId} he picked picture ${pick.imageId}.`
          : pick
            ? `R24: the owner passed on all the drafts of ${ideaId}, so it gets no final.`
            : `R24: a final is made only from a draft the owner picked. He has not picked a draft of ${ideaId} yet.`,
      );
    }
    // A repaired draft stands for the picked one, with its own checks.
    const source = countedOf(draft, await this.deps.images.list(batch.id));
    const hasPack = (await this.deps.brands.product(batch.productId)).photos.some((photo) => photo.kind === "pack");
    const unchecked = await this.needs(batch.id, source, hasPack, await this.deps.checks.all(batch.id));
    if (unchecked.length > 0) throw new Refusal(`R35: the repair of this draft is not checked yet, so it cannot become a final. Still missing: ${unchecked.join("; ")}.`);
    const defect = defectOf(await this.deps.checks.get(batch.id, source.id));
    if (defect) throw new Refusal(`R35: this draft has ${defect.code} (${defect.note}), so it cannot become a final. Repair it with product_swap or product_reprint and check the repair, or tell the owner.`);
    return { finals: made.filter((entry) => entry.imageId).length, source };
  }
}
