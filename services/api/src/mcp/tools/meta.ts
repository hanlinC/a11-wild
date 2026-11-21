import { META_CTAS, type MetaText } from "@a11-wild/shared";
import { z } from "zod";
import type { BatchStore } from "../../batch/store.js";
import type { BrandStore } from "../../brand/store.js";
import type { CopyStore } from "../../copy/store.js";
import type { FactStore } from "../../facts/store.js";
import { metaFaults } from "../../meta/checks.js";
import type { MetaStore } from "../../meta/store.js";
import type { PickStore } from "../../picks/store.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const line = (max: number) => z.string().min(1).max(max);

const variant = z.strictObject({
  primary: line(1200).describe('The text above the picture. It opens with the picture\'s own headline or subline, in full warm sentences, and ends with an order line ("Order yours today."). The first 125 characters show.'),
  headline: line(120).describe("The bold line under the picture: short and plain, about 40 characters. Not a second slogan."),
  description: line(160).describe("The small line that supports the button. No proof stuffed in."),
  cta: z.enum(META_CTAS),
});

/** The states in which a batch has its picks, so its ads can get their text. */
const HAS_PICKS = ["finals", "finished", "done"];

interface Parts {
  batches: BatchStore;
  brands: BrandStore;
  facts: FactStore;
  copy: CopyStore;
  picks: PickStore;
  meta: MetaStore;
}

/** For each idea: every version of its text, and which one a pack would carry. */
const byIdea = (texts: MetaText[]) =>
  [...new Set(texts.map((text) => text.ideaId))].map((ideaId) => {
    const versions = texts.filter((text) => text.ideaId === ideaId);
    return { ideaId, approvedVersion: versions.filter((text) => text.approved).at(-1)?.version ?? null, versions };
  });

export function metaTools({ batches, brands, facts, copy, picks, meta }: Parts): ToolDefinition[] {
  return [
    defineTool({
      name: "meta_save",
      description:
        "Saves the Meta text of the picked ads of a batch: for each ad two variants of primary text, headline, description and a button from the fixed list. Write one idea in each ad, in the buyer's plain words; write a number as a word unless the number is the idea. The studio refuses text with a number that no saved fact holds, an offer on a top-of-funnel ad, or a primary text that does not open with the picture's own line. Saved text is a draft: show it to the owner, next to the text he approved before when there is one, and save his yes with meta_approve. Text he approved is never typed again: a pack reads it from here.",
      input: {
        batchId: id,
        ads: z.array(z.strictObject({ ideaId: id, variants: z.tuple([variant, variant]) })).min(1).max(3),
      },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, ads }, context) => {
        const batch = await batches.get(batchId);
        if (!HAS_PICKS.includes(batch.state)) throw new Refusal(`This batch is "${batch.state}". An ad gets its Meta text after the owner picked its draft.`);
        const ids = ads.map((ad) => ad.ideaId);
        if (new Set(ids).size !== ids.length) throw new Refusal("Give each idea once.");
        const [ideas, chosen, words, saved] = await Promise.all([batches.ideas(batchId), picks.all(batchId), copy.list(batchId), facts.list((await brands.product(batch.productId)).id)]);
        const notes: string[] = [];
        for (const ad of ads) {
          const idea = ideas.find((candidate) => candidate.id === ad.ideaId);
          if (!idea) throw new Refusal(`This batch has no idea ${ad.ideaId}. Its ideas: ${ideas.map((candidate) => candidate.id).join(", ")}.`);
          if (!chosen.some((pick) => pick.ideaId === ad.ideaId && pick.imageId !== null)) throw new Refusal(`The owner picked no draft of ${ad.ideaId}, so it is not an ad and gets no text.`);
          const picture = words.find((entry) => entry.ideaId === ad.ideaId);
          const faults = metaFaults(ad.variants, { ...(picture ? { picture } : {}), ...(idea.stage ? { stage: idea.stage } : {}), facts: saved });
          if (faults.truth.length > 0) throw new Refusal(`The text of ${ad.ideaId} is not saved: ${faults.truth.join("; ")}. Nothing of this call is saved.`);
          notes.push(...faults.notes.map((note) => `${ad.ideaId}, ${note}.`));
        }
        const texts = [];
        for (const ad of ads) texts.push(await meta.save(batchId, { ...ad, by: context.user.email }));
        return {
          saved: texts,
          ...(notes.length > 0 ? { notes } : {}),
          nextStep: "Show the owner each ad's text and wait for his answer. Only he approves it (meta_approve); do not answer for him.",
        };
      },
    }),
    defineTool({
      name: "meta_get",
      description: "Returns the Meta text of a batch: for each ad every version, and the version the owner approved, which is the one a pack carries.",
      input: { batchId: id },
      handler: async ({ batchId }) => {
        await batches.get(batchId);
        return { ads: byIdea(await meta.all(batchId)) };
      },
    }),
    defineTool({
      name: "meta_approve",
      description:
        "Saves the owner's yes to one version of the Meta text of each ad he approved. Show him the text first and wait for his answer; save it with his own words. Only the owner's own session can call this, and no agent answers for him.",
      input: {
        batchId: id,
        ads: z.array(z.strictObject({ ideaId: id, version: z.number().int().min(1), ownerSaid: line(1000).describe("His answer, in his own words.") })).min(1).max(3),
      },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, ads }, context) => {
        if (context.user.role !== "owner") throw new Refusal("Only the owner approves the Meta text.");
        await batches.get(batchId);
        const ids = ads.map((ad) => ad.ideaId);
        if (new Set(ids).size !== ids.length) throw new Refusal("Give each idea once.");
        const all = await meta.all(batchId);
        const missing = ads.find((ad) => !all.some((text) => text.ideaId === ad.ideaId && text.version === ad.version));
        if (missing) throw new Refusal(`There is no version ${missing.version} of the text of ${missing.ideaId}. Read the versions with meta_get.`);
        const approved = [];
        for (const ad of ads) approved.push(await meta.approve(batchId, { ...ad, by: context.user.email }));
        return { approved, nextStep: "When the batch is done, publish its pack: the pack carries this text." };
      },
    }),
  ];
}
