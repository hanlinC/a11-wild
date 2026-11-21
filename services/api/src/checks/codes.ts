import type { BatchKind, CheckCode } from "@a11-wild/shared";

/**
 * The owner's picture checks, carried from a11-adgen's render checklist. A D item is a defect:
 * one of them rejects the picture. An F item is a fault: two of them reject it.
 */
export const CHECK_CODES: Record<CheckCode, string> = {
  D1: "Writing in the picture. No readable words, letters or numbers except the print on the product itself and the brand logo: no note, card, sign, book or printed paper.",
  D2: "Fake food. Food that looks waxy, glossy, invented, cloned or wrong in colour, or that has not the shapes it has in real life. Compare it with the brand's own photo (food_crop).",
  D3: "AI-rendered prop. A drip, spill or stain on a cup, glass or plate; waxy or flat liquid; a lumpy or fused rim or handle; plastic texture where the real material has grain.",
  D4: "Physics. Every object rests on a surface with a contact shadow from the one light, or is held in a hand. Nothing floats, and nothing balances where it could not.",
  D5: "Off-putting placement. No shoes by food, no plates on the floor, no leftovers, nothing odd under or on the product.",
  D6: "Unneeded serving. A serving is shown only when it shows what the pack hides, or the true size of a food sold by weight.",
  D7: "Wrong or garbled logo, or a logo inside a pill or a badge.",
  D8: "Race, ethnicity or religion. No stereotype, and never a person's race, ethnicity or religion as the point of the ad.",
  D9: "Print that does not sit on the product. Each printed line matches the real packshot: crisp, the same weight, rising with the face it is on.",
  D10: "Pasted product light. The product's highlights, shade and reflections come from the scene's own light, with a contact shadow that agrees with the other shadows.",
  D11: "Product drawn wrong. The shape matches the packshot (pack_check, 2%), the cap or neck sits on the centre of the body (cap_check, 1% of the body width), and every printed word stays readable at phone size.",
  F1: "Scale. Every pack, product and prop keeps its real size next to the others.",
  F2: "A prop that does not earn its place. The one object that is the idea, and at most one natural companion.",
  F3: "Cheap or stock prop. Props match the brand's level.",
  F4: "A hand the idea does not need. A hand only for an action the idea turns on; then one plain hand, cropped at the wrist.",
  F5: "Object and idea do not click. The link between the main object and the idea comes within one second.",
  F6: "Busy. One focal product, and five elements or fewer at feed size.",
  F7: "Weak contrast. The product and the logo stand clear of what is behind them at phone size.",
  F8: "Sameness across the batch. The drafts of an idea differ in camera, crop and scale.",
};

/** D1 for an ad with words: the words the owner approved, set by type_set, are the ad and not a fault. */
const D1_WITH_WORDS =
  "Writing the model painted. The only readable words, letters and numbers are the print on the product itself, the brand logo, and the owner's approved headline, subline and footnote that type_set put on the picture: no note, card, sign, book or printed paper, and no word the model drew.";

/** The picture checks as an agent of this kind of ad reads them. */
export const checkCodesFor = (kind: BatchKind): Record<CheckCode, string> => (kind === "v1" ? CHECK_CODES : { ...CHECK_CODES, D1: D1_WITH_WORDS });

export const CHECK_CODE_LIST = Object.keys(CHECK_CODES) as [CheckCode, ...CheckCode[]];
export const isDefect = (code: CheckCode) => code.startsWith("D");
