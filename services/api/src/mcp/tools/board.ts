import { z } from "zod";
import type { BoardService } from "../../board/service.js";
import { CHECK_CODE_LIST } from "../../checks/codes.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);

export function boardTools({ board }: { board: BoardService }): ToolDefinition[] {
  return [
    defineTool({
      name: "checks_save",
      description:
        "Saves your look at one draft or one final: the D and F items you found in it, each with a line on what is wrong. rules_get gives the meaning of D1 to D11 and F1 to F8. Send an empty list when you looked and found nothing. One D item rejects the picture, and a draft with a D item never becomes a final. An item that a pixel tool measured (pack_check, cap_check) is kept: this call cannot remove it. When every draft is checked the batch moves to checked; the reply names what is still missing.",
      input: {
        batchId: id,
        imageId: id.describe("The picture id of the draft or the final."),
        items: z
          .array(z.strictObject({ code: z.enum(CHECK_CODE_LIST), note: z.string().min(3).max(300).describe("What is wrong in this picture.") }))
          .max(19),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, imageId, items }) => board.saveChecks(batchId, imageId, items),
    }),
    defineTool({
      name: "board_show",
      description:
        "The pick board of a batch: each idea's drafts, numbered 1 to 3 in the order they were sent, beside the product's truth sheet, with any D or F item named on the draft. Free. The numbers are names, not a rank: never rank the drafts for the owner and never pick for him. Show him the pictures, or send him to the board in the dashboard. A batch whose drafts are all checked now waits for his pick.",
      input: { batchId: id },
      writes: true,
      handler: ({ batchId }) => board.show(batchId),
    }),
    defineTool({
      name: "pick_save",
      description:
        "Saves the owner's choice for one idea: one of its drafts, or a pass on all of them (imageId null). Only the owner's session can call it, and only after the owner chose in this conversation or on the board. ownerSaid is his own words on why; they go to the taste log. A new choice for the same idea replaces the earlier one, and the log keeps both.",
      input: {
        batchId: id,
        ideaId: id,
        imageId: id.nullable().describe("The picked draft's picture id, or null when the owner passes on all of the idea's drafts."),
        ownerSaid: z.string().min(1).max(2000).describe("The owner's own words."),
      },
      writes: true,
      handler: ({ batchId, ideaId, imageId, ownerSaid }, context) => board.pick(batchId, { ideaId, imageId, ownerSaid }, context.user),
    }),
  ];
}
