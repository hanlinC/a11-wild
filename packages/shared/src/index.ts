/** Types that cross the wire between the API and the dashboard. */

export type Role = "owner" | "member";

export interface Me {
  email: string;
  role: Role;
}

export type ClientStatus = "pending" | "approved" | "revoked";

/** An MCP client (an AI agent's connection) as the Connections page shows it. */
export interface ClientRecord {
  clientId: string;
  name: string;
  callbackUrls: string[];
  status: ClientStatus;
  firstSeenAt: string;
  firstSeenBy: string;
  decidedAt?: string;
}

export interface StudioStatus {
  buildId: string;
  rulesVersion: string;
}

export type SpendService = "parallel" | "fal";

/** One paid call in the ledger. `reserved` means the outcome is not known, so it still counts. */
export interface SpendLine {
  at: string;
  service: SpendService;
  kind: string;
  ref: string;
  batchId?: string;
  usd: number;
  status: "reserved" | "spent" | "released";
}

export interface SpendSummary {
  /** The calendar month, in UTC, as YYYY-MM. */
  month: string;
  monthUsd: number;
  monthCapUsd: number;
  batchCapUsd: number;
  batchId?: string;
  batchUsd?: number;
  lines: SpendLine[];
}

export interface PictureRef {
  /** Where the picture sits in the studio's private store. */
  key: string;
  /** The page address it was copied from. */
  sourceUrl: string;
}

export const PALETTE_ROLES = ["primary", "secondary", "accent", "background", "text"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

export interface BrandKit {
  id: string;
  name: string;
  /** The brand's home page. */
  url: string;
  logo: PictureRef | null;
  palette: { role: PaletteRole; hex: string }[];
  fonts: string[];
  createdAt: string;
  savedBy: string;
  /** The record's id in a11-adgen, when it was copied from there. */
  originId?: string;
}

export interface ProductPhoto extends PictureRef {
  /** `pack` shows the product as sold. `food` shows the brand's own photo of the food itself. */
  kind: "pack" | "food";
}

export interface Product {
  id: string;
  brandId: string;
  name: string;
  /** The product's own page. */
  url: string;
  photos: ProductPhoto[];
  createdAt: string;
  savedBy: string;
}

/** One claim about a product, proven by words copied exactly from a page. */
export interface Fact {
  id: string;
  productId: string;
  claim: string;
  quote: string;
  url: string;
  /** When the studio last read the page and found the quote in it. */
  checkedAt: string;
  savedBy: string;
}

/** One version of the owner's taste canon. Version 0 means none was written yet. */
export interface CanonVersion {
  version: number;
  text: string;
  /** One line on what changed and why. */
  reason: string;
  savedBy: string;
  savedAt: string;
}

/** One thing the owner chose, passed on or said. */
export interface TasteEntry {
  id: string;
  at: string;
  kind: "pick" | "pass" | "note";
  /** The owner's own words. */
  ownerSaid: string;
  /** What it was about, in a line: the brand, the idea, the draft. */
  about?: string;
  batchId?: string;
  ideaId?: string;
  draftId?: string;
  savedBy: string;
  /** The record's id in a11-adgen, when it was copied from there. */
  originId?: string;
}

/** A saved reference. */
export interface SwipeItem {
  id: string;
  title: string;
  /** One line on what the reference does. */
  why: string;
  /** Who made it, or where it is from. */
  source: string;
  sourceUrl?: string;
  tags?: string[];
  addedAt: string;
  savedBy: string;
  originId?: string;
}
