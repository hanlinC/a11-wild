import type { Batch, BatchImage, BatchState, Board, BoardDraft, CheckItem, ImageChecks, Pick, Role } from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import { type CheckStore, defectOf, rejected } from "../checks/store.js";
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

/** The states in which the owner picks. A checked batch moves to `waiting_pick` with his first pick. */
const PICKING: BatchState[] = ["checked", "waiting_pick", "finals"];

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  truth: TruthStore;
  images: ImageStore;
  renders: RenderStore;
  checks: CheckStore;
  picks: PickStore;
  tasteLog: TasteLog;
  pictures: Pictures;
}

/** The picture that counts for a draft or a final: its newest repair (a reprint or a swap), or the picture itself. */
export const countedOf = (image: BatchImage, all: BatchImage[]): BatchImage =>
  all.filter((other) => (other.kind === "reprint" || other.kind === "swap") && other.rootId === image.id).at(-1) ?? image;
/** The real-camera finish that was made from this very picture, the newest one. */
const finishOf = (counted: BatchImage, all: BatchImage[]): BatchImage | undefined => all.filter((other) => other.kind === "finish" && other.fromId === counted.id).at(-1);

/** The drafts of a batch as the owner sees them, the checks that every picture needs, and the owner's picks. */
export class BoardService implements FinalRule {
  constructor(private readonly deps: Deps) {}

  /** The finished pictures of one kind, by idea, in the order they were sent. */
  private async sent(batchId: string, kind: "draft" | "final"): Promise<Map<string, BatchImage[]>> {
    const { renders, images } = this.deps;
    const byId = new Map((await images.list(batchId, kind)).map((image) => [image.id, image]));
    const byIdea = new Map<string, BatchImage[]>();
    for (const render of await renders.list(batchId)) {
      const image = render.kind === kind && render.status === "done" && render.imageId ? byId.get(render.imageId) : undefined;
      if (image) byIdea.set(render.ideaId, [...(byIdea.get(render.ideaId) ?? []), image]);
    }
    return byIdea;
  }

  async board(batchId: string): Promise<Board> {
    const { batches, brands, truth, checks, picks, pictures } = this.deps;
    const batch = await batches.get(batchId);
    const [brand, product, ideas, drafts, finals, found, picked] = await Promise.all([
      brands.brand(batch.brandId),
      brands.product(batch.productId),
      batches.ideas(batchId),
      this.sent(batchId, "draft"),
      this.sent(batchId, "final"),
      checks.all(batchId),
      picks.all(batchId),
    ]);
    const all = await this.deps.images.list(batchId);
    const shown = (list: BatchImage[] = []): Promise<BoardDraft[]> =>
      Promise.all(
        list.map(async (image, index) => {
          const counted = countedOf(image, all);
          const finish = finishOf(counted, all);
          return {
            number: index + 1,
            image,
            shown: counted,
            viewUrl: await pictures.viewUrl(counted.key),
            checks: found.get(counted.id) ?? null,
            ...(finish ? { finish: { image: finish, viewUrl: await pictures.viewUrl(finish.key) } } : {}),
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
        ideas.map(async (idea) => ({
          idea,
          drafts: await shown(drafts.get(idea.id)),
          pick: picked.find((pick) => pick.ideaId === idea.id) ?? null,
          finals: await shown(finals.get(idea.id)),
        })),
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

  /** Moves the batch on when every draft, or every final, is checked. Returns what is still missing. */
  async progress(batch: Batch): Promise<{ batch: Batch; missing: string[] }> {
    const { batches, brands, checks, picks } = this.deps;
    const hasPack = (await brands.product(batch.productId)).photos.some((photo) => photo.kind === "pack");
    const found = await checks.all(batch.id);
    const all = await this.deps.images.list(batch.id);
    const missing: string[] = [];
    if (batch.state === "drafting") {
      const drafts = await this.sent(batch.id, "draft");
      for (const idea of await batches.ideas(batch.id)) {
        const mine = drafts.get(idea.id) ?? [];
        if (mine.length < DRAFTS_PER_IDEA) missing.push(`${DRAFTS_PER_IDEA - mine.length} more finished draft(s) of ${idea.id}`);
        for (const image of mine) missing.push(...(await this.needs(batch.id, countedOf(image, all), hasPack, found)));
      }
      if (missing.length === 0) batch = await batches.move(batch, "checked", "checks_save");
    } else if (batch.state === "finals" || batch.state === "finished") {
      const finals = await this.sent(batch.id, "final");
      const made = await picks.all(batch.id);
      for (const idea of await batches.ideas(batch.id)) {
        const pick = made.find((entry) => entry.ideaId === idea.id);
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
      }
      if (missing.length === 0 && batch.state === "finals") batch = await batches.move(batch, "finished", "checks_save");
      // A finished batch whose final got a D item, or a repair that is not checked yet, is not finished any more.
      else if (missing.length > 0 && batch.state === "finished") batch = await batches.move(batch, "finals", "checks_save");
    }
    return { batch, missing };
  }

  /** Saves the agent's look at a draft or a final. */
  async saveChecks(batchId: string, imageId: string, items: Omit<CheckItem, "tool">[]) {
    const { batches, images, checks } = this.deps;
    const batch = await batches.get(batchId);
    const image = await images.get(batchId, imageId);
    if (!["draft", "final", "reprint", "swap"].includes(image.kind)) {
      throw new Refusal(`Picture ${imageId} is a ${image.kind}. Checks are saved for a draft, a final, or a reprint or swap of one.`);
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
    if (["intake", "truth", "ideas", "judged", "priced", "waiting_spend", "spec_only"].includes(batch.state)) {
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

    const pick = await picks.save(batchId, { ideaId: input.ideaId, imageId: input.imageId, ownerSaid, by: user.email });
    await tasteLog.add({
      kind: draft ? "pick" : "pass",
      ownerSaid,
      about: `${board.brand.name}, ${board.product.name}. ${entry.idea.title}: ${draft ? `draft ${draft.number} of ${entry.drafts.length}` : `passed on all ${entry.drafts.length} drafts`}.`,
      batchId,
      ideaId: input.ideaId,
      ...(draft ? { draftId: draft.image.id } : {}),
      savedBy: user.email,
    });
    const defect = defectOf(draft?.checks ?? undefined);
    return { pick, ...(defect ? { note: `The picked draft has ${defect.code} (${defect.note}), so no final can be made from it. Tell the owner.` } : {}) };
  }

  /** A final is made only from the draft the owner picked, and never from a draft with a D item. */
  async allow(batch: Batch, ideaId: string, draft: BatchImage): Promise<{ finals: number; source: BatchImage }> {
    const made: Pick[] = await this.deps.picks.all(batch.id);
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
