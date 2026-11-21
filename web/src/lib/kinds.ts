import type { BatchKind } from "@a11-wild/shared";

/** The kinds of ad, as the owner reads them. */
export const KIND_NAMES: Record<BatchKind, string> = {
  v1: "Wild, logo only",
  v2: "Headline ad",
  v3: "Concept ad",
};
