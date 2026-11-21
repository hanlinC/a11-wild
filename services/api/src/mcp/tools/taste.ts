import { z } from "zod";
import { BATCH_KINDS } from "@a11-wild/shared";
import type { BatchReads } from "../../batch/reads.js";
import type { BatchStore } from "../../batch/store.js";
import { copyPicture, type Pictures } from "../../pictures/store.js";
import { REFERENCES_MAX, type References } from "../../taste/references.js";
import type { Net } from "../../urlsafety.js";
import type { CanonStore } from "../../taste/canon.js";
import type { TasteLog } from "../../taste/log.js";
import type { SwipeFile } from "../../taste/swipe.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

export interface TasteToolDeps {
  canon: CanonStore;
  tasteLog: TasteLog;
  swipe: SwipeFile;
  reads: BatchReads;
  references: References;
  batches: BatchStore;
  pictures: Pictures;
  net: Net;
}

const batchId = z.string().min(1).max(64).optional().describe("The batch you read this for. The studio records the read; ideas_save needs all three reads.");

export function tasteTools({ canon, tasteLog, swipe, reads, references, batches, pictures, net }: TasteToolDeps): ToolDefinition[] {
  return [
    defineTool({
      name: "canon_get",
      description:
        "The owner's taste canon: his taste in plain words, learned from his picks. Free. Read it before you write ideas, with the batchId. Version 0 means he has not written one yet.",
      input: { batchId, version: z.number().int().min(1).optional().describe("An older version. Leave it out for the current one.") },
      handler: async ({ batchId, version }) => {
        const found = version ? await canon.version(version) : await canon.get();
        if (!version) await reads.mark(batchId, "canon");
        return found;
      },
    }),
    defineTool({
      name: "canon_versions",
      description: "Every version of the taste canon, newest first, with its reason and its author. Free.",
      input: {},
      handler: async () => ({ versions: await canon.versions() }),
    }),
    defineTool({
      name: "canon_save",
      description:
        "Saves a new version of the taste canon. Only the owner's taste goes in, in plain words, and only with his say: show him the new text and the reason first. Send the WHOLE canon, not the change. Old versions stay readable.",
      input: {
        text: z.string().min(1).describe("The whole canon."),
        reason: z.string().describe("One line: what changed and why, with the owner's words when he gave them."),
      },
      writes: true,
      handler: ({ text, reason }, context) => {
        if (context.user.role !== "owner") throw new Refusal("Only the owner can change the taste canon.");
        return canon.save({ text, reason, by: context.user.email });
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
