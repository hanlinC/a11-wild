import { z } from "zod";
import { FINAL_POINTS } from "@a11-wild/shared";
import type { BoardService } from "../../board/service.js";
import { CHECK_CODE_LIST } from "../../checks/codes.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);

const point = z.strictObject({ passed: z.boolean(), note: z.string().max(400).describe("What you saw. Needed when the point fails.") });

export function boardTools({ board }: { board: BoardService }): ToolDefinition[] {
  return [
    defineTool({
      name: "final_points_save",
      description:
        "Saves your eight-point look at the final of a concept ad (v3) as the owner would send it: after photo_finish and type_set. Free. Look at the picture twice, at full size and at phone size (about 320 wide), and judge each point: concept (the picture and the headline still say the one thing, and the headline points at something seen), productTruth (shape, print, size and colour as the real product), brandIdentity (the real logo, the brand's colour and font), copyAccuracy (the words are the approved ones, readable at phone size, and each claim is a saved fact), food (real food, or none), composition (one focal point, room for the words, the lockup of the direction), craft (light, shadow, edges, no pasted look), renderChecklist (no D item and fewer than two F items). A final with a failed point is not delivered and never enters a pack.",
      input: {
        batchId: id,
        imageId: id.describe("The picture with the words set on the finished final: the id type_set gave."),
        points: z.strictObject(Object.fromEntries(FINAL_POINTS.map((name) => [name, point])) as Record<(typeof FINAL_POINTS)[number], typeof point>),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, imageId, points }, context) => board.savePoints(batchId, { imageId, points }, context.user.email),
    }),
    defineTool({
      name: "checks_save",
      description:
        "Saves your look at one draft or one final: the D and F items you found in it, each with a line on what is wrong. rules_get gives the meaning of D1 to D11 and F1 to F8. Send an empty list when you looked and found nothing. One D item rejects the picture, and a draft with a D item never becomes a final. An item that a pixel tool measured (pack_check, cap_check) is kept: this call cannot remove it. In a batch with words, look at each picture twice: the bare picture, and the picture type_set made from it, by that picture's own id. A D item on the picture with its words means the type is set again. When every draft is checked the batch moves to checked; the reply names what is still missing.",
      input: {
        batchId: id,
        imageId: id.describe("The picture id of the draft or the final, of a repair of one, or of the picture type_set made from one."),
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
