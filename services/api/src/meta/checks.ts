import type { ApprovedCopy, Fact, FunnelStage, MetaVariant } from "@a11-wild/shared";
import { namesOffer, unprovenNumbers } from "../ideas/checks.js";

/** How much of the primary text shows before "See more", and about how long a headline shows in full. */
export const PRIMARY_SHOWN = 125;
export const HEADLINE_SHOWN = 40;

/** Words as they are compared: no line-break marks, no punctuation, one case. */
const plain = (text: string) =>
  text
    .replace(/\|/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%]+/gu, " ")
    .trim();

export interface MetaContext {
  /** The words on the picture. A picture with no words has none. */
  picture?: Pick<ApprovedCopy, "headline" | "subline">;
  stage?: FunnelStage;
  /** Every saved fact of the product. */
  facts: Pick<Fact, "claim" | "quote">[];
}

/**
 * The countable facts of the Meta text of one ad. `truth` faults stop the save: a number no fact holds,
 * an offer on a top-of-funnel ad, a primary text that does not open with the picture's own line.
 * `notes` are a guide: how much of the text shows.
 */
export function metaFaults(variants: MetaVariant[], { picture, stage, facts }: MetaContext): { truth: string[]; notes: string[] } {
  const truth: string[] = [];
  const notes: string[] = [];
  variants.forEach((variant, index) => {
    const name = `variant ${index === 0 ? "A" : "B"}`;
    const all = [variant.primary, variant.headline, variant.description].join(" ");
    const unproven = unprovenNumbers(all, facts);
    if (unproven.length > 0) truth.push(`${name}: no saved fact holds the number ${unproven.join(", ")}`);
    if (stage === "tof" && namesOffer(all)) truth.push(`${name}: the text of a top-of-funnel ad names no price, saving or delivery offer`);
    if (picture) {
      const opening = plain(variant.primary);
      const lines = [picture.headline, picture.subline].map(plain).filter(Boolean);
      // The picture and the text read as one ad: the text starts where the picture stops.
      if (!lines.some((line) => opening.startsWith(line))) {
        truth.push(`${name}: the primary text opens with the picture's own line ("${picture.headline.replace(/\s*\|\s*/g, " ")}" or "${picture.subline}")`);
      }
    }
    if (variant.primary.length > PRIMARY_SHOWN) notes.push(`${name}: the primary text has ${variant.primary.length} characters, and the first ${PRIMARY_SHOWN} show before "See more"`);
    if (variant.headline.length > HEADLINE_SHOWN) notes.push(`${name}: the headline has ${variant.headline.length} characters, and about ${HEADLINE_SHOWN} show in full`);
  });
  return { truth, notes };
}
