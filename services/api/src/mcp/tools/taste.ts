import { z } from "zod";
import { BATCH_KINDS, type Batch, CANON_SCOPES, type CanonScope } from "@a11-wild/shared";
import type { BatchReads } from "../../batch/reads.js";
import type { BatchStore } from "../../batch/store.js";
import { copyPicture, type Pictures } from "../../pictures/store.js";
import { REFERENCES_MAX, type References } from "../../taste/references.js";
import type { Net } from "../../urlsafety.js";
import type { BrandNotes } from "../../brand/notes.js";
import type { BrandStore } from "../../brand/store.js";
import { type CanonStore, OWNER_TASTE, scopeName, scopeOf } from "../../taste/canon.js";
import { LEARNING_LIST_MAX, type LearningStore } from "../../taste/learning.js";
import { EVIDENCE_FOR_EVERY_BRAND, type ProposalStore } from "../../taste/proposals.js";
import type { TasteLog } from "../../taste/log.js";
import type { SwipeFile } from "../../taste/swipe.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";
import { teachesNothing } from "../../batch/state.js";

export interface TasteToolDeps {
  canon: CanonStore;
  tasteLog: TasteLog;
  swipe: SwipeFile;
  reads: BatchReads;
  references: References;
  batches: BatchStore;
  pictures: Pictures;
  net: Net;
  brands: BrandStore;
  learning: LearningStore;
  proposals: ProposalStore;
  brandNotes: BrandNotes;
}

const id = z.string().min(1).max(64);
const words = (max: number) => z.string().trim().min(1).max(max);
const scope = z
  .strictObject({ kind: z.enum(CANON_SCOPES), brandId: id.optional().describe("Only for the scope of a brand.") })
  .optional()
  .describe("Which canon: the owner's taste (the default), one brand, creative craft (what makes a picture read), or performance (what results showed).");
/** The canons a batch reads besides the owner's taste: its own brand's, craft and performance. Never another brand's. */
const scopesOf = (brandId: string): CanonScope[] => [{ kind: "brand", brandId }, { kind: "craft" }, { kind: "performance" }];

const batchId = z.string().min(1).max(64).optional().describe("The batch you read this for. The studio records the read; ideas_save needs all three reads.");

const aBatch = (batch: Batch) => (batch.test ? "A test batch" : "An outreach batch");

export function tasteTools({ canon, tasteLog, swipe, reads, references, batches, pictures, net, brands, learning, proposals, brandNotes }: TasteToolDeps): ToolDefinition[] {
  /** A scope that names a brand names one the studio has. */
  async function checked(input: { kind: CanonScope["kind"]; brandId?: string | undefined } | undefined): Promise<CanonScope> {
    const found = scopeOf(input);
    if (found.kind === "brand") await brands.brand(found.brandId as string);
    return found;
  }
  const ownerOnly = (role: string, what: string) => {
    if (role !== "owner") throw new Refusal(`Only the owner can ${what}.`);
  };
  return [
    defineTool({
      name: "canon_get",
      description:
        "The owner's taste canon: his taste in plain words, learned from his picks. Free. Read it before you write ideas, with the batchId: the reply then also holds the canons this batch follows besides his taste (its own brand's, creative craft, performance) in `also`, and what he chose for this brand before in `brandNotes`. A batch never gets the rules of another brand. Version 0 means that canon is not written yet.",
      input: { batchId, version: z.number().int().min(1).optional().describe("An older version. Leave it out for the current one."), scope },
      handler: async ({ batchId, version, scope }) => {
        const asked = await checked(scope);
        const batch = batchId ? await batches.get(batchId) : undefined;
        if (batch && asked.kind === "brand" && asked.brandId !== batch.brandId) {
          throw new Refusal(`Batch ${batch.id} is for another brand. A batch reads the rules of its own brand only: leave the scope out, and the reply holds them.`);
        }
        const found = version ? await canon.version(version, asked) : await canon.get(asked);
        if (!batch || version || asked.kind !== "owner") return found;
        await reads.mark(batchId, "canon");
        const also = (await Promise.all(scopesOf(batch.brandId).map((other) => canon.get(other)))).filter((other) => other.version > 0);
        return { ...found, also, brandNotes: await brandNotes.list(batch.brandId) };
      },
    }),
    defineTool({
      name: "canon_versions",
      description: "Every version of a canon, newest first, with its reason and its author. Free. With no scope: the owner's taste.",
      input: { scope },
      handler: async ({ scope }) => ({ versions: await canon.versions(await checked(scope)) }),
    }),
    defineTool({
      name: "canon_save",
      description:
        "Saves a new version of a canon. With no scope it is the owner's taste: only his taste goes in, in plain words, and only with his say: show him the new text and the reason first. Send the WHOLE canon, not the change. Old versions stay readable. To suggest a change yourself, use canon_propose: the owner decides it.",
      input: {
        text: z.string().min(1).describe("The whole canon."),
        reason: z.string().describe("One line: what changed and why, with the owner's words when he gave them."),
        scope,
      },
      writes: true,
      handler: async ({ text, reason, scope }, context) => {
        ownerOnly(context.user.role, "change a canon");
        return canon.save({ text, reason, by: context.user.email, scope: await checked(scope) });
      },
    }),
    defineTool({
      name: "canon_restore",
      description: "Brings an earlier version of a canon back, as a new version. Only with the owner's say. Nothing is removed: the version it replaces stays readable (canon_versions).",
      input: { version: z.number().int().min(1), reason: words(500).describe("Why, with the owner's words."), scope },
      writes: true,
      handler: async ({ version, reason, scope }, context) => {
        ownerOnly(context.user.role, "restore a canon");
        return canon.restore({ version, reason, by: context.user.email, scope: await checked(scope) });
      },
    }),
    defineTool({
      name: "learn",
      description: `Saves a learning record: something the studio saw, and the lesson it may teach. A record changes nothing by itself. It never changes a product fact (facts_save does that, from a source) and never a canon: a lesson reaches a canon only through canon_propose and the owner's yes. Give the scope the lesson was seen in: one brand, the owner's taste, creative craft or performance. One correction on one brand is a record of that brand, not a rule for every brand.`,
      input: {
        observation: words(1000).describe("What was seen, as a fact: what the owner said or chose, what a check found, what a results file showed."),
        source: words(300).describe("Where it was seen: the owner's words, a batch, a results file."),
        scope: z.strictObject({ kind: z.enum(CANON_SCOPES), brandId: id.optional() }).describe("Where the lesson holds."),
        lesson: words(600).describe("The proposed lesson, in plain words, as a line a canon could hold."),
        evidence: z.number().int().min(1).max(1000).describe("How many separate times it was seen. One correction is 1."),
        confidence: z.enum(["low", "medium", "high"]),
        examples: z.array(words(400)).max(10).describe("Where it held: a batch and an ad, or the owner's words."),
        counterexamples: z.array(words(400)).max(10).describe("Where it did not hold. Empty when none is known."),
        expectedEffect: words(400).describe("What should change when the lesson is followed."),
        testResult: words(600).optional().describe("What happened when it was tried, if it was."),
        batchId: id.optional().describe("The batch it was seen in."),
      },
      writes: true,
      needsRules: true,
      handler: async ({ scope, batchId, testResult, ...input }, context) => {
        const found = await checked(scope);
        const batch = batchId ? await batches.get(batchId) : undefined;
        if (batch && found.kind === "brand" && found.brandId !== batch.brandId) throw new Refusal(`Batch ${batch.id} is for another brand than the scope names.`);
        // What a tester did in a test batch is not what the studio saw the owner do.
        if (batch && teachesNothing(batch)) throw new Refusal(`${aBatch(batch)} teaches the studio nothing: no learning record is saved from it.`);
        return learning.add({ ...input, scope: found, ...(testResult ? { testResult } : {}), ...(batchId ? { batchId } : {}), savedBy: context.user.email });
      },
    }),
    defineTool({
      name: "learning_list",
      description: `The learning records, newest first: what the studio saw and what each may teach. Free. With a batchId: the records this batch may read (the owner's taste, craft, performance and its own brand). None of them is a rule: only a canon is.`,
      input: { batchId: id.optional(), scope, limit: z.number().int().min(1).max(LEARNING_LIST_MAX).optional() },
      handler: async ({ batchId, scope, limit }) => {
        const batch = batchId ? await batches.get(batchId) : undefined;
        const asked = scope ? await checked(scope) : undefined;
        if (batch && asked?.kind === "brand" && asked.brandId !== batch.brandId) throw new Refusal(`Batch ${batch.id} is for another brand. A batch reads the records of its own brand only.`);
        const scopes = asked ? [asked] : batch ? [OWNER_TASTE, ...scopesOf(batch.brandId)] : undefined;
        return { records: await learning.list({ ...(scopes ? { scopes } : {}), ...(limit ? { limit } : {}) }) };
      },
    }),
    defineTool({
      name: "canon_propose",
      description: `Proposes a change to a canon, for the owner to decide. It is not active: no batch reads it until he says yes (canon_decide). Send the WHOLE canon of that scope as it would read, the reason, and the learning records it rests on (learn). The records are of the same scope. A change to a canon that every brand follows (the owner's taste, craft, performance) rests on ${EVIDENCE_FOR_EVERY_BRAND} sightings or more. Then show the owner the change in plain words.`,
      input: {
        scope: z.strictObject({ kind: z.enum(CANON_SCOPES), brandId: id.optional() }),
        text: z.string().min(1).describe("The whole canon of that scope as it would read."),
        reason: words(500).describe("One line: what changes and why."),
        recordIds: z.array(id).min(1).max(20).describe("The learning records it rests on."),
      },
      writes: true,
      needsRules: true,
      handler: async ({ scope, text, reason, recordIds }, context) => proposals.propose({ scope: await checked(scope), text, reason, recordIds, by: context.user.email }),
    }),
    defineTool({
      name: "canon_proposals",
      description: "The proposed changes to the canons, newest first, each with its status: proposed (it waits for the owner), approved or declined. Free.",
      input: { id: id.optional().describe("One proposal, with its text. Leave it out for the list without the texts.") },
      handler: async ({ id }) => {
        if (id) {
          const proposal = await proposals.get(id);
          return { proposal, current: await canon.get(proposal.scope) };
        }
        return { proposals: (await proposals.list()).map(({ text: _text, ...proposal }) => ({ ...proposal, scopeName: scopeName(proposal.scope) })) };
      },
    }),
    defineTool({
      name: "canon_decide",
      description: "Saves the owner's yes or no to a proposed canon change. Only the owner decides, in his own words: show him the current canon and the proposed one first. A yes makes the next version of that canon; a no keeps the proposal as a record. A proposal written against an older version of the canon is refused: propose again from the current one.",
      input: { id, approve: z.boolean(), ownerSaid: words(500).describe("The owner's own words.") },
      writes: true,
      needsRules: true,
      handler: async ({ id, approve, ownerSaid }, context) => {
        ownerOnly(context.user.role, "decide a proposal");
        return proposals.decide({ id, approve, ownerSaid, by: context.user.email });
      },
    }),
    defineTool({
      name: "brand_note",
      description: "Saves what the owner chose for one brand, in his words (for example: show the cap, not the pump). The next batch of that brand gets it with canon_get. It is his choice for this brand only, not a rule for another brand, and not a product fact: a fact goes through facts_save with its source.",
      input: { brandId: id, note: words(500).describe("The choice, in plain words."), ownerSaid: words(500).describe("The owner's own words."), batchId: id.optional().describe("The batch he said it in.") },
      writes: true,
      needsRules: true,
      handler: async ({ brandId, note, ownerSaid, batchId }, context) => {
        ownerOnly(context.user.role, "save a brand note");
        await brands.brand(brandId);
        const batch = batchId ? await batches.get(batchId) : undefined;
        if (batch && batch.brandId !== brandId) throw new Refusal(`Batch ${batch.id} is for another brand.`);
        if (batch && teachesNothing(batch)) throw new Refusal(`${aBatch(batch)} teaches the studio nothing: no brand note is saved from it.`);
        return brandNotes.add({ brandId, note, ownerSaid, ...(batchId ? { batchId } : {}), savedBy: context.user.email });
      },
    }),
    defineTool({
      name: "brand_notes",
      description: "What the owner chose for one brand before, newest first. Free. A batch of that brand gets the same list with canon_get.",
      input: { brandId: id },
      handler: async ({ brandId }) => {
        await brands.brand(brandId);
        return { notes: await brandNotes.list(brandId) };
      },
    }),
    defineTool({
      name: "taste_log",
      description:
        "What the owner picked, what he passed on and what he said, newest first, in his own words. Free. Read it before you write ideas, with the batchId.",
      input: {
        batchId,
        limit: z.number().int().min(1).max(100).default(30),
        before: z.string().max(40).optional().describe("An ISO time. Gives only what he said earlier than it."),
      },
      handler: async ({ batchId, limit, before }) => {
        const entries = await tasteLog.list({ limit, ...(before ? { before } : {}) });
        await reads.mark(batchId, "taste_log");
        return { entries };
      },
    }),
    defineTool({
      name: "taste_note",
      description:
        "Saves something the owner said about the work, in his exact words. Save only what he said: never write a view for him.",
      input: {
        ownerSaid: z.string().min(1).max(2000).describe("His exact words."),
        about: z.string().max(300).optional().describe("What it was about, in a line."),
        batchId: z.string().min(1).max(64).optional(),
      },
      writes: true,
      handler: ({ ownerSaid, about, batchId }, context) =>
        tasteLog.add({ kind: "note", ownerSaid, savedBy: context.user.email, ...(about ? { about } : {}), ...(batchId ? { batchId } : {}) }),
    }),
    defineTool({
      name: "swipe_search",
      description:
        "Searches the owner's swipe file: saved references, each with one line on what it does. Free. Read it before you write ideas, with the batchId. No words gives the newest items.",
      input: { words: z.string().max(200).default(""), batchId },
      handler: async ({ words, batchId }) => {
        const items = await swipe.search(words);
        await reads.mark(batchId, "swipe");
        return { items };
      },
    }),
    defineTool({
      name: "swipe_add",
      description: "Saves a reference to the swipe file when the owner says a piece of work is worth keeping.",
      input: {
        title: z.string().min(1).max(200),
        why: z.string().min(1).max(500).describe("One line on what the reference does."),
        source: z.string().min(1).max(200).describe("Who made it, or where it is from."),
        sourceUrl: z.string().max(2000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(8).optional(),
      },
      writes: true,
      handler: ({ title, why, source, sourceUrl, tags }, context) =>
        swipe.add({ title, why, source, savedBy: context.user.email, ...(sourceUrl ? { sourceUrl } : {}), ...(tags ? { tags } : {}) }),
    }),
    defineTool({
      name: "references_get",
      description:
        "The owner's reference ads for this batch's kind of ad: finished ads he holds up as the bar, each with a link that opens the picture for a few minutes and a line on what it does. Free. Open each picture and look at it before you write ideas, before you write a render prompt, and before you judge. For an ad with words (v2) they are the bar for the idea, the words, the type and the craft, and ideas_save needs this read. For v1 they are loose examples of usable work, never a template. A reference shows a level, not a layout to copy: never reuse its idea, its words or its scene.",
      input: { batchId: z.string().min(1).max(64) },
      handler: async ({ batchId: forBatch }) => {
        const batch = await batches.get(forBatch);
        const found = await references.of(batch.kind);
        await reads.mark(forBatch, "references");
        return {
          kind: batch.kind,
          use:
            batch.kind === "v1"
              ? "Loose examples of usable v1 work. The owner has few v1 references: do not treat them as a strict guide."
              : "The bar. New work is as clear, as bold and as well made as these, with its own idea.",
          references: await Promise.all(
            found.map(async ({ picture, savedBy: _savedBy, ...reference }) => ({ ...reference, viewUrl: await pictures.viewUrl(picture.key) })),
          ),
        };
      },
    }),
    defineTool({
      name: "reference_add",
      description:
        "Saves an ad as one of the owner's references, when he says a finished ad is the bar for a kind of ad. Owner only. The studio copies the picture to its private store.",
      input: {
        url: z.string().max(2000).describe("The picture's https address on a public host."),
        kinds: z.array(z.enum(BATCH_KINDS)).min(1).max(3).describe("The kinds of ad it is a reference for."),
        brand: z.string().min(1).max(80),
        title: z.string().min(1).max(200).describe("The ad's headline, or a short name for an ad with no words."),
        why: z.string().min(1).max(500).describe("What the ad does, in one or two lines."),
        loose: z.boolean().default(false).describe("True for an example of usable work that is not a template."),
      },
      writes: true,
      handler: async ({ url, kinds, brand, title, why, loose }, context) => {
        if (context.user.role !== "owner") throw new Refusal("Only the owner can save a reference.");
        if ((await references.count()) >= REFERENCES_MAX) throw new Refusal(`The studio keeps ${REFERENCES_MAX} references or fewer.`);
        const stored = await copyPicture({ url, folder: "references", what: "The reference picture" }, net, pictures);
        const { picture: _picture, ...saved } = await references.add({ kinds: [...new Set(kinds)], brand, title, why, ...(loose ? { loose } : {}), picture: { key: stored.key, sourceUrl: url }, savedBy: context.user.email });
        return saved;
      },
    }),
  ];
}
