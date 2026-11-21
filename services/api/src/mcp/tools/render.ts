import { z } from "zod";
import { DRAFTS_PER_IDEA, REFERENCES_MAX, type RenderService, ROUGHS_PER_BATCH, ROUGHS_PER_CONCEPT } from "../../render/service.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);

export function renderTools({ render }: { render: RenderService }): ToolDefinition[] {
  return [
    defineTool({
      name: "render_submit",
      description: `Sends one picture to the model: a rough or a draft (low quality, 1024 by 1280) or a final (high quality, 1536 by 1920). A rough is a first look at a concept of a v3 batch, made before the owner picks concepts and before any words are approved: at most ${ROUGHS_PER_CONCEPT} for one concept and ${ROUGHS_PER_BATCH} for a batch, drawn from the product's real photos in references, with no skeleton. It costs money, so only the owner's session can call it. Describe the scene only: a prompt that asks for words in the picture is refused, and the studio adds the picture rules itself. A draft of a product with a pack photo is built round a skeleton (fromId, from skeleton_make); each of an idea's ${DRAFTS_PER_IDEA} drafts has its own skeleton, with another camera, crop or scale. A final is made from the draft the owner picked (fromId), and never from a draft with a D item. The first draft of a batch goes alone to read the price; the rest wait for it, and for the owner's yes when the estimate is US$1 or more. The same holds for finals. The reply is a job: read it with render_status.`,
      input: {
        batchId: id,
        ideaId: id.describe('The idea the picture is for: "idea-1".'),
        kind: z.enum(["rough", "draft", "final"]),
        prompt: z.string().min(20).max(4000).describe("The scene, in plain words: camera, light, surface, props. No words to paint."),
        fromId: id.optional().describe("The skeleton of a draft, or the picked draft of a final."),
        references: z
          .array(z.string().regex(/^(logo|(pack|food|prop)-\d{1,2})$/))
          .max(REFERENCES_MAX)
          .default([])
          .describe('Other pictures the model sees, by name: "logo" for the brand\'s logo, "pack-1" for the product\'s first pack photo, "food-2" for its second food photo, "prop-1" for its first prop photo.'),
      },
      writes: true,
      paid: true,
      needsRules: true,
      handler: ({ batchId, ideaId, kind, prompt, fromId, references }) =>
        render.submit({ batchId, ideaId, kind, prompt, ...(fromId ? { fromId } : {}), references }),
    }),
    defineTool({
      name: "render_status",
      description:
        "Reads a render. Free. While the model works the status is queued: read again in a few seconds. When it is done, the picture is in the studio's private store and the reply has a link that opens it for a few minutes. When the first draft or the first final is done, the reply gives the estimate for the rest and says whether the owner's yes is needed.",
      input: { batchId: id, renderId: id },
      writes: true,
      handler: ({ batchId, renderId }) => render.status(batchId, renderId),
    }),
    defineTool({
      name: "render_list",
      description: "Every render of a batch, in the order they were sent, with its status and its picture. Free. A session that resumes a batch starts here.",
      input: { batchId: id },
      handler: async ({ batchId }) => ({ renders: await render.list(batchId) }),
    }),
  ];
}
