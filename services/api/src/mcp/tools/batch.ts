import { z } from "zod";
import type { Batch } from "@a11-wild/shared";
import type { DoneGate } from "../../batch/done.js";
import type { BatchReads } from "../../batch/reads.js";
import { requireMove, stepAfter } from "../../batch/state.js";
import type { BatchStore } from "../../batch/store.js";
import type { BrandStore } from "../../brand/store.js";
import type { CriticStore } from "../../critic/store.js";
import type { FactStore } from "../../facts/store.js";
import { ELEMENTS_MAX, ideaFaults, IDEAS_PER_BATCH } from "../../ideas/checks.js";
import type { TruthStore } from "../../truth/store.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

export interface BatchToolDeps {
  batches: BatchStore;
  brands: BrandStore;
  facts: FactStore;
  truth: TruthStore;
  reads: BatchReads;
  critic: CriticStore;
  done: DoneGate;
}

const id = z.string().min(1).max(64);
const line = (max: number) => z.string().min(1).max(max);
const test = (what: string) => z.strictObject({ passed: z.boolean(), note: line(400).describe("One line on why.") }).describe(what);

const CANNOT_RENDER =
  "The studio makes one kind of picture: a static 4:5 ad. For this format the step it cannot do is rendering. It keeps the facts, the truth sheet, the ideas and a text spec.";

export function batchTools({ batches, brands, facts, truth, reads, critic, done }: BatchToolDeps): ToolDefinition[] {
  /** What a session needs to go on with a batch, from its id alone. */
  async function view(batch: Batch) {
    // A batch that saved a sheet keeps that version. A batch that has not yet sees the product's newest.
    const [brand, product, sheet, newest, ideas, unread, judged] = await Promise.all([
      brands.brand(batch.brandId),
      brands.product(batch.productId),
      truth.get(batch.productId, batch.truthVersion),
      truth.get(batch.productId),
      batches.ideas(batch.id),
      reads.missing(batch.id),
      critic.verdicts(batch.id),
    ]);
    const newer = sheet && newest && newest.version > sheet.version ? newest.version : undefined;
    const next =
      batch.state === "truth" && unread.length > 0
        ? `read the owner's taste for this batch (${unread.join(", ")} with batchId), then ${stepAfter("truth")}`
        : batch.state === "ideas" && batch.format === "other"
          ? "save the text spec (spec_save)"
          : stepAfter(batch.state);
    return { batch, nextStep: next, brand, product, factCount: (await facts.list(product.id)).length, truthSheet: sheet ?? null,
      ...(newer
        ? { truthNote: `This batch keeps version ${sheet?.version} of the truth sheet, which it saved. The product's sheet is now at version ${newer} (truth_get reads it).` }
        : {}),
      ideas,
      // What the blind critic said of the ideas, so that a cut idea can be written again.
      ...(judged ? { criticOnIdeas: judged } : {}),
      tasteNotRead: unread,
    };
  }

  return [
    defineTool({
      name: "batch_create",
      description:
        "Starts a batch for one saved brand and one saved product of it. Free. The owner names both first: offer brand_list, or read a new address with brand_extract. format is static_4x5 for the picture the studio makes; for any other format (a story, a video, a carousel) give other and the owner's words in formatNote, and the batch ends with a text spec.",
      input: {
        brandId: id,
        productId: id,
        format: z.enum(["static_4x5", "other"]).default("static_4x5"),
        formatNote: line(200).optional().describe('The format in the owner\'s words, when format is other: "9:16 story".'),
        label: line(80).optional(),
      },
      writes: true,
      handler: async ({ brandId, productId, format, formatNote, label }, context) => {
        await brands.brand(brandId);
        const product = await brands.product(productId);
        if (product.brandId !== brandId) throw new Refusal("That product belongs to another brand. brand_list gives each brand's products.");
        if (format === "other" && !formatNote) throw new Refusal("Give formatNote: the format in the owner's words.");
        const batch = await batches.create({ brandId, productId, format, createdBy: context.user.email, ...(formatNote ? { formatNote } : {}), ...(label ? { label } : {}) });
        return { ...(await view(batch)), ...(format === "other" ? { note: CANNOT_RENDER } : {}) };
      },
    }),
    defineTool({
      name: "batch_get",
      description:
        "A batch with everything saved for it: its state, the brand, the product, the truth sheet, the ideas, and nextStep. Free. A new session resumes a batch with this call and the batch id alone.",
      input: { batchId: id },
      handler: async ({ batchId }) => view(await batches.get(batchId)),
    }),
    defineTool({
      name: "batch_list",
      description: "The batches, newest first, each with its state. Free.",
      input: {},
      handler: async () => ({ batches: await batches.list() }),
    }),
    defineTool({
      name: "truth_save",
      description:
        "Saves the product's truth sheet: its real shape, its packaging, and every number a picture must get right (heights, widths, weights, cap sizes). Give factId for a number that a saved fact proves; the sheet then carries the fact's quote and page. A number with no factId is kept and marked unverified: never guess a factId. For food, give the keys of the brand's own food photos and how the food is cut or served. A product has one sheet, shared by its batches: batch_get shows the newest before this batch saves one. A save that changes it makes a new version and the earlier ones stay; a save that changes nothing keeps the version. The batch keeps the version it saved.",
      input: {
        batchId: id,
        shape: line(1000).describe("The product's shape in plain words."),
        packaging: line(1500).describe("What it is packed in, and what is printed where."),
        measures: z
          .array(
            z.strictObject({
              name: line(80).describe('What is measured: "pack height".'),
              value: z.number().positive(),
              unit: line(12).describe("mm, cm, g, ml."),
              factId: id.optional().describe("The saved fact that proves this number."),
            }),
          )
          .max(30),
        food: z.strictObject({ photoKeys: z.array(line(300)).max(6), proportions: line(1000) }).optional(),
      },
      writes: true,
      handler: async ({ batchId, shape, packaging, measures, food }, context) => {
        const batch = await batches.get(batchId);
        if (batch.state !== "intake" && batch.state !== "truth") {
          throw new Refusal(`The truth sheet of this batch is settled: the batch is at "${batch.state}". Start a new batch to change it.`);
        }
        const product = await brands.product(batch.productId);
        const sheet = await truth.save(
          product,
          { shape, packaging, measures: measures.map(({ factId, ...rest }) => ({ ...rest, ...(factId ? { factId } : {}) })), ...(food ? { food } : {}) },
          context.user.email,
        );
        const moved = await batches.move(batch, "truth", "truth_save", { truthVersion: sheet.version });
        const unverified = sheet.measures.filter((measure) => measure.status === "unverified").map((measure) => measure.name);
        return { state: moved.state, truthSheet: sheet, unverified };
      },
    }),
    defineTool({
      name: "truth_get",
      description:
        "A product's truth sheet and the list of its versions. Free. Without version, the newest. Each save that changes the sheet makes a new version and the earlier ones stay, so a batch can keep the version its ideas were written from.",
      input: { productId: id, version: z.number().int().min(1).optional() },
      handler: async ({ productId, version }) => {
        await brands.product(productId);
        const sheet = await truth.get(productId, version);
        if (!sheet && version !== undefined) throw new Refusal(`This product's truth sheet has no version ${version}.`);
        return { truthSheet: sheet ?? null, versions: await truth.versions(productId) };
      },
    }),
    defineTool({
      name: "ideas_save",
      description: `Saves the batch's ${IDEAS_PER_BATCH} ideas, all in one call. Before it, read canon_get, taste_log and swipe_search with this batchId: the call is refused until all three were read. Each idea has ONE device, ONE focal point, ${ELEMENTS_MAX} elements or fewer, at least one reference from outside the product's category with what it does, a cover test and a kill test. An idea fails the kill test, and is cut, when it has an impossible shape, an unreal prop, a claim that is not a saved fact, a rival attack the picture cannot show, race, ethnicity or religion, or a health claim. The server counts; the taste is yours and the owner's.`,
      input: {
        batchId: id,
        ideas: z
          .array(
            z.strictObject({
              title: line(120),
              visual: line(1500).describe("What the picture shows, in a few lines."),
              device: line(300).describe("The one thing the idea turns on."),
              focalPoint: line(300).describe("Where the eye lands first."),
              elements: z.array(line(200)).max(12).describe(`Everything in the picture. ${ELEMENTS_MAX} or fewer.`),
              references: z
                .array(z.strictObject({ what: line(300), does: line(400).describe("One line on what the reference does."), url: z.string().url().max(2000).optional() }))
                .max(6)
                .describe("Work from outside the product's category."),
              coverTest: test("Cover the logo: is it still this brand's ad, and no other's?"),
              killTest: test("Does it stay clear of every kill reason?"),
            }),
          )
          .max(10),
      },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, ideas }, context) => {
        const batch = await batches.get(batchId);
        if (batch.state !== "ideas") requireMove(batch.state, "ideas", "ideas_save");
        const unread = await reads.missing(batchId);
        if (unread.length > 0) {
          throw new Refusal(`Read the owner's taste for this batch first. Not read yet: ${unread.join(", ")}. Call each with batchId "${batchId}".`);
        }
        const clean = ideas.map(({ references, ...idea }) => ({ ...idea, references: references.map(({ url, ...ref }) => ({ ...ref, ...(url ? { url } : {}) })) }));
        const faults = ideaFaults(clean);
        if (faults.length > 0) throw new Refusal(`The ideas are not saved. ${faults.join(" ")}`);
        const saved = clean.map((idea, index) => ({ id: `idea-${index + 1}`, ...idea }));
        await batches.saveIdeas(batchId, saved, context.user.email);
        const moved = await batches.move(batch, "ideas", "ideas_save");
        return {
          state: moved.state,
          ideas: saved,
          nextStep: batch.format === "other" ? "save the text spec (spec_save)" : stepAfter("ideas"),
          ...(batch.format === "other" ? { note: CANNOT_RENDER } : {}),
        };
      },
    }),
    defineTool({
      name: "batch_done",
      description:
        "The done gate. Free. It measures the owner's conditions for this batch and gives each as passed or failed with its evidence: he picked one draft for each idea; each pick became a final with no D item, the right shape and its real-camera finish. When both hold, the batch is marked done. The reply also lists strangerTest: what the studio cannot measure. Give that list to the owner; he runs that test himself, and you never answer it for him.",
      input: { batchId: id },
      writes: true,
      handler: ({ batchId }) => done.close(batchId),
    }),
    defineTool({
      name: "spec_save",
      description:
        "Saves the text spec of a batch whose format is not a static 4:5 picture: the layout, the shot list or the panel script, from the saved ideas. The batch ends there. The studio does not render it.",
      input: { batchId: id, spec: line(20_000) },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, spec }) => {
        const batch = await batches.get(batchId);
        if (batch.format !== "other") throw new Refusal("This batch is a static 4:5 picture: the studio renders it. A text spec is for the other formats.");
        const moved = await batches.move(batch, "spec_only", "spec_save", { spec });
        return { state: moved.state, note: CANNOT_RENDER };
      },
    }),
  ];
}
