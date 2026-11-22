import { z } from "zod";
import type { PixelService } from "../../pixels/service.js";
import { defineTool, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const px = z.number().int().min(0).max(4096);
const fraction = z.number().min(0).max(1);
const colour = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "A colour as RRGGBB.");
const box = z.tuple([px, px, px, px]);
const packNumber = z
  .number()
  .int()
  .min(1)
  .max(12)
  .default(1)
  .describe("Which pack this is when the picture shows more than one: 1 for the first from the left, 2 for the next. Measure every pack. Each pack keeps its own result, so a pass on one never clears a fail on another.");
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
      .array(
        z
          .object({
            cx: fraction,
            base: fraction,
            height: z.number().min(0.05).max(1),
            side: z.enum(["up", "L", "R"]).default("up"),
            rot: z.number().min(-15).max(15).default(0),
            photo: z.string().regex(/^(pack|food|prop)-\d{1,2}$/).optional(),
            cutout: cutout.optional(),
            blur: z.number().min(0).max(12).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export function pixelTools({ pixels }: { pixels: PixelService }): ToolDefinition[] {
  return [
    defineTool({
      name: "skeleton_make",
      description:
        "Makes a skeleton: the real pack, cut from the product's pack photo, on a blank 4:5 canvas at its true proportions. Free. Use it before every draft of a product that has a pack photo, and give its picture id to render_submit as fromId: a model keeps what is already in its picture, so the pack's shape is right by construction. Each draft of an idea needs its own skeleton, with another place, scale or crop. Give either one pack (height, cx, base, count) or a plan with each pack's place, side and small turn, and flat shapes for a surface. Leave clear stage round each thing, a third of a pack's width or more: the model draws things a little larger than the skeleton, and a pack that touches its neighbour or its food cannot be measured alone. Only a skeleton made from a plan can be reprinted later. The pack photo needs a plain backdrop or its own transparency. The reply is a job: pixel_status gives the picture.",
      input: {
        batchId: id,
        ideaId: id,
        bg: colour.optional().describe("The canvas colour as RRGGBB: the stage of the scene. Needed without a plan."),
        height: z.number().min(0.05).max(1).default(0.5).describe("The pack's height as a share of the canvas height."),
        cx: fraction.default(0.5).describe("The pack's centre, as a share of the width."),
        base: fraction.default(0.9).describe("Where the pack's base is, as a share of the height."),
        count: z.number().int().min(1).max(6).default(1),
        gap: z.number().min(0).max(2).default(0.18).describe("The gap between packs, as a share of one pack's width."),
        plan: plan
          .optional()
          .describe(
            'Each pack at its own place. cx, base and height are shares of the canvas; side is up, L or R (lying); rot is a small turn in degrees. A product may be another real photo of this product in place of the pack: photo "food-2" or "prop-1" (a real slice of each flavour, a real prop), cut from its plain backdrop. A product with no pack photo (a cake, a dish) is built from such photos alone: every item names one.',
          ),
        vary: z
          .object({ regions: z.array(box).min(1).max(6), seed: z.number().int().min(0).max(100000).default(7) })
          .strict()
          .optional()
          .describe("With a plan of two or more packs that show food through a window: the food areas in the pack photo (x0,y0,x1,y1 in pixels). Each pack then gets its own arrangement of the real food, so a row is not the same pack copied."),
        box: box.optional().describe("x0,y0,x1,y1 of the pack in the pack photo, in pixels. Leave it out and the studio finds it."),
        cutout: cutout.optional().describe("Tuning for a pack photo whose backdrop is not found with the defaults."),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, ideaId, plan: layout, vary, bg, box: packBox, cutout: tuning, ...one }) =>
        pixels.skeleton({
          batchId,
          ideaId,
          placement: { ...(layout ? { plan: layout, ...(vary ? { vary } : {}) } : { ...one, bg }), ...(packBox ? { box: packBox } : {}), ...(tuning ? { cutout: tuning } : {}) },
        }),
    }),
    defineTool({
      name: "pack_check",
      description:
        "Measures whether the pack in a picture is as tall and as wide as the real pack, within 2%. Free. Run it on every draft and every final that shows the pack of a product with a pack photo: the batch does not move on without it. A concept ad (v3) that shows the food alone, and whose render named no pack photo, needs none. The real pack is the product's first pack photo, or the pack photo the picture's render named when the model drew it with no skeleton. The pack needs a plain stage of one colour round it, apart from every other pack and thing, and seen from the front: a pack that touches another, or lies in steep perspective, cannot be measured. When it stands on something, give a box that ends at its base. When it is turned in the plane (it lies on the stage at an angle), send tilted. A fail is saved on the picture as D11, and only a later pass of this tool on the same pack of the same picture clears it. A picture with more than one pack: measure each, with its pack number. The reply is a job: pixel_status gives the measure.",
      input: {
        batchId: id,
        imageId,
        at: z.tuple([px, px]).describe("X,Y of a point inside the pack, in pixels of the picture."),
        bg: colour.describe("The stage colour as RRGGBB."),
        sideways: z.boolean().default(false).describe("The pack lies on its side."),
        tilted: z.boolean().default(false).describe("The pack is turned in the plane, for example it lies on the stage at 20 degrees. The tool turns it upright before the measure."),
        box: box.optional().describe("X0,Y0,X1,Y1 in pixels, for a pack that stands on something: a box round the pack with plain stage on its other sides, ending at the pack's base. The measure then stops at the base, so set it within a few pixels."),        pack: packNumber,
      },
      writes: true,
      handler: ({ box: around, ...input }) => pixels.packCheck({ ...input, ...(around ? { box: around } : {}) }),
    }),
    defineTool({
      name: "cap_check",
      description:
        "Measures whether the cap, lid or neck of a bottle or jar sits on the centre of its body, within 1% of the body width. Free. Run it on every draft and every final of a bottle or a jar: a final is a new picture, so measure it again. The bottle must stand on a plain stage that is lighter than it. A fail is saved on the picture as D11, and only a later pass on the same bottle clears it. A picture with more than one bottle: measure each, with its pack number. The reply is a job: pixel_status gives the measure.",
      input: {
        batchId: id,
        imageId,
        box: box.describe("X0,Y0,X1,Y1 in pixels: the bottle with some plain stage on both sides, ending at its base above any contact shadow."),
        split: px.describe("Y in pixels: the first row below the cap and the neck (the top of any shoulder)."),        pack: packNumber,
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
      name: "type_set",
      description:
        "Sets the words the owner approved, and the brand's real logo, on a draft or a final of a batch with words (v2 or v3), in the brand's own font. In a concept ad (v3) the words stand where the direction says (flush left, flush right, or a band at the top with the words on its left), and the logo heads the column on its edge unless you give logoX. Free. The words come from copy_approve: you cannot type them here. Run it on every draft before the owner sees it, and on every final after photo_finish; a draft or a final without it does not count. Set it again after a repair, or after the owner changes the words. The tool stops when the words do not fit, sit too close to an edge, the logo or the product, or run over a sharp colour or shadow edge: move the area, or render the backdrop under the words as one plain tone. Use ' | ' in the approved headline to break lines; keep one logo size and place, and one headline top, on every ad of the batch. It makes a new picture; read it with pixel_status, look at it at phone size, and save that look with checks_save under the new picture's id: the blind critic ranks, and the owner picks, the picture with its words.",
      input: {
        batchId: id,
        imageId: id.describe("A draft or a final of this batch, or a repair of one."),
        area: z.tuple([fraction, fraction, fraction, fraction]).describe("x0,y0,x1,y1 of the text block, as shares of the picture. Keep 4% or more to each edge."),
        family: z.string().min(1).max(60).optional().describe("The font family, one saved with font_save. Default: the brand kit's first font."),
        weight: z.number().int().min(100).max(1000).default(800).describe("The headline weight. The studio uses the nearest saved file."),
        subFamily: z.string().min(1).max(60).optional().describe("The font family of the subline, one saved with font_save, when the brand sets its small words in a second face. Default: the headline family."),
        subWeight: z.number().int().min(300).max(1000).optional().describe("The subline weight: one lighter than the headline, never Light."),
        colour: colour.default("000000").describe("The colour of the words as RRGGBB, from the brand palette."),
        align: z.enum(["left", "right", "center"]).default("left"),
        case: z.enum(["asis", "upper"]).default("upper").describe("upper: the headline in capitals (the poster style). asis for a soft display serif."),
        subCase: z.enum(["asis", "upper"]).default("asis"),
        leading: z.number().min(0.8).max(2).default(1.0),
        subRatio: z.number().min(0.2).max(1).default(0.45).describe("The subline size as a share of the headline size: 0.4 to 0.5."),
        gap: z.number().min(0).max(2).default(0.25),
        minHead: z.number().min(0).max(0.5).default(0.05).describe("The tool stops when the headline is smaller than this share of the picture height."),
        productTop: z.number().min(0.01).max(1).optional().describe("The product's top edge as a share of the height: the words end 4% or more above it."),
        accent: z.string().max(120).optional().describe("Headline words set in the accent colour: one key phrase, on one ad of a batch at most."),
        accentColour: colour.optional(),
        logo: z.boolean().default(true).describe("Draw the brand's saved logo above the words."),
        logoWidth: z.number().min(0.02).max(1).default(0.25),
        logoTop: z.number().min(0).max(0.9).default(0.045),
        logoX: fraction.optional().describe("The logo's left edge as a share of the width. Default: centred. Give the text column's left edge so the logo heads the words."),
        logoColour: colour.optional().describe("A one-colour version of the logo: a light one for a dark picture."),
        footnoteAlign: z.enum(["left", "right"]).optional(),
        footnoteY: z.number().min(0.5).max(0.99).optional(),
      },
      writes: true,
      needsRules: true,
      handler: ({ batchId, imageId, family, weight, subFamily, subWeight, logo, accent, accentColour, logoX, logoColour, productTop, footnoteAlign, footnoteY, logoWidth, logoTop, ...layout }) =>
        pixels.typeSet({
          batchId,
          imageId,
          ...(family ? { family } : {}),
          weight,
          ...(subFamily ? { subFamily } : {}),
          ...(subWeight ? { subWeight } : {}),
          logo,
          layout: {
            ...layout,
            ...(logo ? { logoWidth, logoTop, ...(logoX !== undefined ? { logoX } : {}), ...(logoColour ? { logoColour } : {}) } : {}),
            ...(accent ? { accent, accentColour } : {}),
            ...(productTop !== undefined ? { productTop } : {}),
            ...(footnoteAlign ? { footnoteAlign } : {}),
            ...(footnoteY !== undefined ? { footnoteY } : {}),
          },
        }),
    }),
    defineTool({
      name: "food_grade",
      description:
        "Moves the colour of the food in a picture toward a real close-up photo of the same food. Free. Use it when real food looks pale or flat beside the brand's own close-up. Only colour moves: texture and shape stay, and the colour never goes past the real photo. It makes a new picture that stands for the old one: check it again.",
      input: {
        batchId: id,
        imageId,
        regions: z.array(box).min(1).max(8).describe("Where the food shows in the picture: x0,y0,x1,y1 in pixels, one for each food area."),
        photo: z.number().int().min(1).max(20).default(1).describe("Which of the product's food photos is the close-up: 1 is the first."),
        refBox: box.describe("x0,y0,x1,y1 of a patch of the close-up that is all food, in pixels."),
        strength: fraction.default(0.8),
        refBg: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional().describe("R,G,B of the close-up's plain backdrop, which is not counted as food."),
        satMin: fraction.optional().describe("Lower it for pale food."),
        dist: z.number().min(0).max(255).optional().describe("Lower it for pale food."),
      },
      writes: true,
      needsRules: true,
      handler: ({ refBg, satMin, dist, ...input }) => pixels.foodGrade({ ...input, ...(refBg ? { refBg } : {}), ...(satMin !== undefined ? { satMin } : {}), ...(dist !== undefined ? { dist } : {}) }),
    }),
    defineTool({
      name: "product_relight",
      description:
        "Makes a pasted pack take the scene's light, so it does not look pasted: shade on the side away from the light, bounce light from the floor colour, and a contact shadow where the pack meets the floor. Free. Use it after product_swap or on a picture where the pack looks cut out. It makes a new picture that stands for the old one: check it again.",
      input: {
        batchId: id,
        imageId,
        box: box.describe("x0,x1,top,base of the pack in the picture, in pixels."),
        light: z.enum(["left", "right"]).describe("The side the light comes from. A shadow that falls left means light from the right."),
        floor: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).describe("R,G,B of the surface the pack stands on."),
        shade: z.number().min(0).max(0.6).default(0.3),
        contact: fraction.default(0.55),
      },
      writes: true,
      needsRules: true,
      handler: (input) => pixels.relight(input),
    }),
    defineTool({
      name: "box_print",
      description:
        "Puts the printed words of a boxed product (a cake box, a carton) back from the real pack photo, crisp and at the box's own angle. Free. Use it on a final whose small print the model smeared (D9); the picture must show the printed face at an angle near the pack photo's. Product, light and shadow are not touched. It makes a new picture that stands for the old one: check it again at full size beside the pack photo.",
      input: {
        batchId: id,
        imageId,
        face: box.describe("x0,y0,x1,y1 of the printed face in the pack photo, in pixels."),
        blocks: z
          .array(
            z
              .object({
                box: box.describe("x0,y0,x1,y1 of one block of print in the pack photo."),
                thr: z.tuple([fraction, fraction, z.number().min(0).max(5)]).optional().describe("The ink threshold [low, high, blur]. Default [0.40, 0.60, 0.6]; condensed capitals need a tighter cut."),
                ink_rel: z.number().gt(0).max(1).optional(),
                xmin: px.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(12),
      },
      writes: true,
      needsRules: true,
      handler: (input) => pixels.boxPrint(input),
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
