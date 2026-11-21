import type { Lockup } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";

/** The lowest edge of the words in a band at the top, as a share of the picture height. */
export const TOP_BAND_MAX = 0.45;

const PLACE: Record<Lockup, string> = {
  flush_left: "a column flush left: align left, in the left half of the picture",
  flush_right: "a column flush right: align right, in the right half of the picture",
  top_band_left: `a band at the top with the words on its left: align left, starting in the left half and ending in the top ${TOP_BAND_MAX * 100}% of the picture`,
};

/**
 * Puts the words of a concept ad where its direction says. The countable facts only: the side the
 * column is flush to, the half it stands in, and the logo at the head of the column on its edge.
 */
export function lockupLayout(lockup: Lockup, ideaId: string, layout: Record<string, unknown>): Record<string, unknown> {
  const [x0, , x1, y1] = layout.area as [number, number, number, number];
  const centre = (x0 + x1) / 2;
  const align = lockup === "flush_right" ? "right" : "left";
  const placed = lockup === "flush_left" ? centre < 0.5 : lockup === "flush_right" ? centre > 0.5 : x0 < 0.5 && y1 <= TOP_BAND_MAX;
  if (layout.align !== align || !placed) {
    throw new Refusal(`The direction of ${ideaId} puts its words in ${PLACE[lockup]}. Set them there, or save a new direction (direction_save) when the picture leaves that place no room.`);
  }
  // The logo is small at the head of the column, on the column's own edge.
  const width = layout.logoWidth as number | undefined;
  if (width === undefined || layout.logoX !== undefined) return layout;
  return { ...layout, logoX: Math.max(0, Math.round((align === "left" ? x0 : x1 - width) * 1000) / 1000) };
}
