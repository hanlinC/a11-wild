import type { Batch, DoneCondition, DoneReport } from "@a11-wild/shared";
import type { BoardService } from "../board/service.js";
import type { CopyStore } from "../copy/store.js";
import { unprovenNumbers } from "../ideas/checks.js";
import type { BrandStore } from "../brand/store.js";
import type { FactStore } from "../facts/store.js";
import { Refusal } from "../mcp/registry.js";
import type { TruthStore } from "../truth/store.js";
import { hasWords } from "./state.js";
import type { BatchStore } from "./store.js";

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  facts: FactStore;
  truth: TruthStore;
  board: BoardService;
  copy: CopyStore;
}

/** The owner's own conditions for calling a batch done: the ones the studio can measure, and the ones only he can judge. */
export class DoneGate {
  constructor(private readonly deps: Deps) {}

  /** Each condition with what the studio measured. It changes nothing. */
  async report(batch: Batch): Promise<DoneReport> {
    if (batch.format !== "static_4x5") throw new Refusal("This batch ended with a text spec: the studio made no picture for it, so it has no done gate.");
    const { brands, facts, truth, board } = this.deps;
    const [finals, product, sheet] = await Promise.all([board.finals(batch), brands.product(batch.productId), truth.get(batch.productId, batch.truthVersion)]);

    const unpicked = finals.filter((entry) => !entry.pick?.imageId);
    const picks: DoneCondition = {
      name: "picks",
      asks: "The owner has picked one draft for each idea.",
      passed: finals.length > 0 && unpicked.length === 0,
      evidence:
        finals.length === 0
          ? "The batch has no idea yet."
          : unpicked.length > 0
            ? unpicked.map((entry) => (entry.pick ? `${entry.ideaId}: he passed on all its drafts, so it has no final` : `${entry.ideaId}: no pick yet`)).join("; ")
            : finals.map((entry) => `${entry.ideaId}: picture ${entry.pick?.imageId}`).join("; "),
    };

    const picked = finals.filter((entry) => entry.pick?.imageId);
    const open = picked.flatMap((entry) => entry.missing);
    const hasPack = product.photos.some((photo) => photo.kind === "pack");
    const made: DoneCondition = {
      name: "finals",
      asks: "Each pick became a final with no D item, and its shape matches the real product.",
      passed: picked.length > 0 && open.length === 0,
      evidence:
        picked.length === 0
          ? "No draft is picked, so there is no final to judge."
          : open.length > 0
            ? `Still missing: ${open.join("; ")}.`
            : `${picked.length} final(s): each is checked, has no D item and fewer than two F items, ${hasPack ? "passed pack_check against the pack photo, " : ""}and has its real-camera finish.`,
    };

    const conditions = [picks, made];
    if (hasWords(batch.kind)) {
      // An ad with words: each final carries the owner's own words, and each number in them is on the fact sheet.
      const [approved, known] = await Promise.all([this.deps.copy.list(batch.id), facts.list(product.id)]);
      const lines = picked.map((entry) => {
        const words = approved.find((copy) => copy.ideaId === entry.ideaId);
        if (!words) return { ok: false, line: `${entry.ideaId}: the owner has not approved its words (copy_approve)` };
        const loose = unprovenNumbers(`${words.headline} ${words.subline}`, known);
        return loose.length > 0
          ? { ok: false, line: `${entry.ideaId}: no saved fact holds ${loose.join(", ")}` }
          : { ok: true, line: `${entry.ideaId}: "${words.headline}" / "${words.subline}" (version ${words.version})` };
      });
      conditions.push({
        name: "words",
        asks: "Each final carries the words the owner approved, and every number in them traces to a saved fact.",
        passed: lines.length > 0 && lines.every((entry) => entry.ok),
        evidence: lines.length === 0 ? "No draft is picked, so there are no words to judge." : lines.map((entry) => entry.line).join("; "),
      });
    }
    const unverified = (sheet?.measures ?? []).filter((measure) => measure.status === "unverified").map((measure) => measure.name);
    return {
      batch,
      done: batch.state === "done",
      conditions,
      strangerTest: [
        "Show each final, alone, to a person who does not know the brand. They say what is sold, and whose it is.",
        "They take it for a real photograph of the real product.",
        "The last question is the owner's: would a company pay for this?",
        `The studio cannot read a picture. Check that anything a final shows as a fact (a mark, a weight, an ingredient) is on the fact sheet, which holds ${(await facts.list(product.id)).length} fact(s).`,
        ...(unverified.length > 0 ? [`The truth sheet marks these numbers unverified, so no page proves them: ${unverified.join(", ")}.`] : []),
      ],
    };
  }

  /** Marks the batch done when every condition holds. Otherwise it says which one does not. */
  async close(batchId: string): Promise<DoneReport & { nextStep: string }> {
    const { batches, board } = this.deps;
    // The finals are looked at again first: a final that got a D item after the batch was finished takes it back to its finals.
    let { batch } = await board.progress(await batches.get(batchId));
    const report = await this.report(batch);
    const failed = report.conditions.filter((condition) => !condition.passed);
    // A test batch is never done: its words and its picks are not the owner's.
    if (failed.length === 0 && batch.state === "finished" && !batch.test) batch = await batches.move(batch, "done", "batch_done");
    const done = batch.state === "done";
    return {
      ...report,
      batch,
      done,
      nextStep: batch.test
        ? `This is a test batch, so it is never marked done and its ads go to no one. ${failed.length === 0 ? "Every condition holds" : `Not met: ${failed.map((condition) => condition.name).join(", ")}`}.`
        : done
        ? "The batch is done. Give the owner the strangerTest list: he runs that test himself."
        : failed.length > 0
          ? `The batch is not done. Not met: ${failed.map((condition) => condition.name).join(", ")}. Each one's evidence says what is missing.`
          : `The batch is not done: it is at "${batch.state}".`,
    };
  }
}
