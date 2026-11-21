import type { FunnelStage } from "@a11-wild/shared";

const SINGAPORE_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The ISO week of a moment on the Singapore clock (UTC+8). The week of a year starts on Monday; week 1 holds the year's first Thursday. */
export function singaporeWeek(at: Date): number {
  const local = new Date(at.getTime() + SINGAPORE_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  // The Thursday of this week decides the year the week belongs to.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** A brand's name as an ad name carries it: small letters and digits only. */
export const brandSlug = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") || "brand";

const two = (n: number) => String(n).padStart(2, "0");

export interface AdNameParts {
  /** The moment the pack is published: its week is the ad's week. */
  at: Date;
  brand: string;
  /** The brand's batches counted from 1, oldest first. It keeps two batches of one brand in one week apart. */
  batchNumber: number;
  /** The funnel stage of an ad with words. A v1 picture has none and is named "wild". */
  stage?: FunnelStage;
  /** The idea's place in its batch, from 1. */
  idea: number;
  /** The version of the pack. */
  version: number;
}

/**
 * The name of one ad, made by the studio and never typed: a client's result is matched to its ad by it.
 * `a11_W47_irvins_b02_tof_c1_v1`.
 */
export const adName = ({ at, brand, batchNumber, stage, idea, version }: AdNameParts): string =>
  `a11_W${two(singaporeWeek(at))}_${brandSlug(brand)}_b${two(batchNumber)}_${stage ?? "wild"}_c${idea}_v${version}`;
