import { z } from "zod";
import type { PixelService } from "../../pixels/service.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const px = z.number().int().min(0).max(4096);
const fraction = z.number().min(0).max(1);
const colour = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "A colour as RRGGBB.");
const box = z.tuple([px, px, px, px]);
const imageId = id.describe("A draft, a final, or a reprint or swap of one, of this batch.");

const cutout = z
  .object({
    darkMax: z.number().int().min(0).max(255).optional(),
    lightSat: fraction.optional(),
    lightMin: z.number().int().min(0).max(255).optional(),
    open: z.number().int().min(1).max(15).optional(),
    smooth: z.number().min(0).max(20).optional(),
    erode: z.number().int().min(0).max(10).optional(),
    edges: z.string().regex(/^(top|bottom|left|right)(,(top|bottom|left|right)){0,3}$/).optional(),
  })
  .strict();

const plan = z
  .object({
    size: z.tuple([z.literal(1024), z.literal(1280)]).default([1024, 1280]),
    bg: colour,
    shapes: z.array(z.object({ rect: z.tuple([fraction, fraction, fraction, fraction]), fill: colour }).strict()).max(12).default([]),
    products: z
      .array(z.object({ cx: fraction, base: fraction, height: z.number().min(0.05).max(1), side: z.enum(["up", "L", "R"]).default("up"), rot: z.number().min(-15).max(15).default(0) }).strict())
      .min(1)
      .max(8),
  })
  .strict();

export function pixelTools({ pixels }: { pixels: PixelService }): ToolDefinition[] {
  return [
    defineTool({
      name: "skeleton_make",
      description:
        "Makes a skeleton: the real pack, cut from the product's pack photo, on a blank 4:5 canvas at its true proportions. Free. Use it before every draft of a product that has a pack photo, and give its picture id to render_submit as fromId: a model keeps what is already in its picture, so the pack's shape is right by construction. Each draft of an idea needs its own skeleton, with another place, scale or crop. Give either one pack (height, cx, base, count) or a plan with each pack's place, side and small turn, and flat shapes for a surface. Only a skeleton made from a plan can be reprinted later. The pack photo needs a plain backdrop or its own transparency. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        ideaId: id,
        bg: colour.optional().describe("The canvas colour as RRGGBB: the stage of the scene. Needed without a plan."),
        height: z.number().min(0.05).max(1).default(0.5).describe("The pack's height as a share of the canvas height."),
        cx: fraction.default(0.5).describe("The pack's centre, as a share of the width."),
        base: fraction.default(0.9).describe("Where the pack's base is, as a share of the height."),
        count: z.number().int().min(1).max(6).default(1),
        gap: z.number().min(0).max(2).default(0.18).describe("The gap between packs, as a share of one pack's width."),
        plan: plan.optional().describe("Each pack at its own place. cx, base and height are shares of the canvas; side is up, L or R (lying); rot is a small turn in degrees."),
        box: box.optional().describe("x0,y0,x1,y1 of the pack in the pack photo, in pixels. Leave it out and the studio finds it."),
        cutout: cutout.optional().describe("Tuning for a pack photo whose backdrop is not found with the defaults."),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ideaId, plan: layout, bg, box: packBox, cutout: tuning, ...one }) =>
        pixels.skeleton({
          batchId,
          ideaId,
          placement: { ...(layout ? { plan: layout } : { ...one, bg }), ...(packBox ? { box: packBox } : {}), ...(tuning ? { cutout: tuning } : {}) },
        }),
    }),
    defineTool({
      name: "pack_check",
      description:
        "Measures whether the pack in a picture is as tall and as wide as the real pack, within 2%. Free. Run it on every draft and every final of a product with a pack photo: the batch does not move on without it. The pack needs a plain stage of one colour round it; when it stands on something, give a box that ends at its base. A fail is saved on the picture as D11, and only a later pass of this tool on the same picture clears it. The reply is a job: pixel_status gives the measure.",
      input: {
        batchId: id,
        imageId,
        at: z.tuple([px, px]).describe("X,Y of a point inside the pack, in pixels of the picture."),
        bg: colour.describe("The stage colour as RRGGBB."),
        sideways: z.boolean().default(false).describe("The pack lies on its side."),
        box: box.optional().describe("X0,Y0,X1,Y1 in pixels, for a pack that stands on something: a box round the pack with plain stage on its other sides, ending at the pack's base. The measure then stops at the base, so set it within a few pixels."),
      },
      writes: true,
      handler: ({ box: around, ...input }) => pixels.packCheck({ ...input, ...(around ? { box: around } : {}) }),
    }),
    defineTool({
      name: "cap_check",
      description:
        "Measures whether the cap, lid or neck of a bottle or jar sits on the centre of its body, within 1% of the body width. Free. Run it on every draft and every final of a bottle or a jar: a final is a new picture, so measure it again. The bottle must stand on a plain stage that is lighter than it. A fail is saved on the picture as D11. The reply is a job: pixel_status gives the measure.",
      input: {
        batchId: id,
        imageId,
        box: box.describe("X0,Y0,X1,Y1 in pixels: the bottle with some plain stage on both sides, ending at its base above any contact shadow."),
        split: px.describe("Y in pixels: the first row below the cap and the neck (the top of any shoulder)."),
      },
      writes: true,
      handler: (input) => pixels.capCheck(input),
    }),
    defineTool({
      name: "product_reprint",
      description:
        "Puts the real print of the pack photo back on each pack of a picture that was built round a plan skeleton. Free. Use it when the model smeared small print (D9) but kept the pack's place and shape. It makes a new picture that stands for the old one: check it again with checks_save and pack_check. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        imageId,
        face: box.describe("x0,y0,x1,y1 of the printed face in the pack photo: below the cap and the top folds, inside the edges."),
      },
      writes: true,
      needsRules: true,
      handler: (input) => pixels.reprint(input),
    }),
    defineTool({
      name: "product_swap",
      description:
        "Replaces the drawn pack in a picture with the real one from the pack photo. Free. Use it to repair a picked draft or a final whose pack has the wrong shape (D11) on a plain stage. It makes a new picture that stands for the old one: check it again with checks_save and pack_check. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        imageId,
        old: box.describe("x0,x1,top,base of the drawn pack in the picture, in pixels."),
        scale: z.number().positive().max(20).optional().describe("Paste at this scale instead of fitting the old pack."),
        cx: px.optional().describe("The centre x of the pasted pack. Default: the centre of the old one."),
        lowerOnly: z.boolean().default(false).describe("Keep the scene above the label: for an open jar."),
        bandTop: px.optional().describe("With lowerOnly: y of the label's top band in the pack photo."),
      },
      writes: true,
      needsRules: true,
      handler: ({ scale, cx, bandTop, ...input }) =>
        pixels.swap({ ...input, ...(scale !== undefined ? { scale } : {}), ...(cx !== undefined ? { cx } : {}), ...(bandTop !== undefined ? { bandTop } : {}) }),
    }),
    defineTool({
      name: "photo_finish",
      description:
        "Gives a final the finish of a real camera: tone, a little softness, halation, lens fall-off and grain. Free. Run it once on each final, after its checks pass, on the final or on its repair; a batch is finished only when each final has it. The same final gets the same grain each time. Name the logo's box in sharp so it stays crisp, and the brand's colours in keep so they stay exact. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        imageId: id.describe("A final, or a reprint or swap of a final."),
        strength: z.number().min(0).max(2).default(1).describe("0 is no change, 1 is the tuned look."),
        sharp: z.array(z.tuple([fraction, fraction, fraction, fraction])).max(6).default([]).describe("Boxes to keep crisp, as shares of the picture: x0,y0,x1,y1. The logo, and small print."),
        keep: z.array(colour).max(6).default([]).describe("Brand colours as RRGGBB that tone and halation leave exact."),
      },
      writes: true,
      needsRules: true,
      handler: (input) => pixels.finish(input),
    }),
    defineTool({
      name: "food_crop",
      description:
        "Cuts the food out of a picture and puts it beside the brand's own photo of that food, at one height. Free. Use it on every picture that shows food, then look at the two halves: food whose shape, colour or surface differs from the real thing is D2 in checks_save. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        imageId,
        box: box.describe("X0,Y0,X1,Y1 of the food in the picture, in pixels."),
        photo: z.number().int().min(1).max(20).default(1).describe("Which of the product's food photos to compare with: 1 is the first."),
      },
      writes: true,
      handler: (input) => pixels.foodCrop(input),
    }),
    defineTool({
      name: "pixel_status",
      description:
        "Reads a pixel job. Free. While the tool works the status is queued: read again in a few seconds. When it is done the reply has what the tool measured, or the picture it made with a link that opens it for a few minutes.",
      input: { batchId: id, jobId: id },
      writes: true,
      handler: ({ batchId, jobId }) => pixels.status(batchId, jobId),
    }),
  ];
}
