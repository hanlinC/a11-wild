import { z } from "zod";
import type { BatchReads } from "../../batch/reads.js";
import type { CanonStore } from "../../taste/canon.js";
import type { TasteLog } from "../../taste/log.js";
import type { SwipeFile } from "../../taste/swipe.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

export interface TasteToolDeps {
  canon: CanonStore;
  tasteLog: TasteLog;
  swipe: SwipeFile;
  reads: BatchReads;
}

const batchId = z.string().min(1).max(64).optional().describe("The batch you read this for. The studio records the read; ideas_save needs all three reads.");

export function tasteTools({ canon, tasteLog, swipe, reads }: TasteToolDeps): ToolDefinition[] {
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
  ];
}
