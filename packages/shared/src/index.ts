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
  palette: { role: PaletteRole; hex: string; note?: string }[];
  fonts: string[];
  /** How the brand speaks, in the owner's words. */
  voice?: string;
  /** Words and claims the brand never uses. */
  neverSay?: string[];
  /** What else the owner settled about this brand. */
  notes?: string;
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

/** The steps of a batch, in order. A batch's state is the last step that is done. */
export const BATCH_STATES = [
  "intake",
  "truth",
  "ideas",
  "judged",
  "priced",
  "waiting_spend",
  "drafting",
  "checked",
  "waiting_pick",
  "finals",
  "finished",
  "done",
  "spec_only",
] as const;
export type BatchState = (typeof BATCH_STATES)[number];

export interface Batch {
  id: string;
  brandId: string;
  productId: string;
  /** `static_4x5` is the one picture the studio makes. Any other format gets a text spec. */
  format: "static_4x5" | "other";
  /** The owner's words for a format the studio does not render, such as "9:16 story". */
  formatNote?: string;
  label?: string;
  state: BatchState;
  /** The version of the product's truth sheet that this batch saved. Its ideas are written from it. */
  truthVersion?: number;
  /** The text spec of a batch whose format the studio does not render. */
  spec?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

/** One number of a truth sheet. It has a saved fact as its source, or it is unverified. */
export interface Measure {
  /** What is measured: "pack height", "net weight", "cap diameter". */
  name: string;
  value: number;
  unit: string;
  status: "sourced" | "unverified";
  /** The fact that proves it, with its quote and page, when it is sourced. */
  source?: { factId: string; quote: string; url: string };
}

/** What is true about a product's body, so that a picture can be checked against it. */
export interface TruthSheet {
  productId: string;
  /** Counts from 1. A save that changes the sheet makes a new version, and no version is changed or removed. */
  version: number;
  /** The product's shape in plain words. */
  shape: string;
  /** What it is packed in, and what is printed where. */
  packaging: string;
  measures: Measure[];
  /** For food: the brand's own photos of it and how it is cut or served. */
  food?: { photoKeys: string[]; proportions: string };
  savedAt: string;
  savedBy: string;
}

export interface IdeaTest {
  passed: boolean;
  /** One line on why. */
  note: string;
}

export interface Idea {
  id: string;
  title: string;
  /** What the picture shows, in a few lines. */
  visual: string;
  /** The one thing the idea turns on. */
  device: string;
  /** Where the eye lands first. */
  focalPoint: string;
  /** Everything in the picture. Five or fewer. */
  elements: string[];
  /** Work from outside the product's category, each with what it does. */
  references: { what: string; does: string; url?: string }[];
  /** Cover the logo: is it still this brand's ad, and no other's? */
  coverTest: IdeaTest;
  /** Does it stay clear of every kill reason? */
  killTest: IdeaTest;
}

/** A picture with a link that opens it for a few minutes. */
export type Viewable<T> = T & { viewUrl: string };

/** What the dashboard's brand list shows. */
export interface BrandSummary {
  brand: BrandKit;
  logoUrl: string | null;
  products: { id: string; name: string }[];
}

/** What the dashboard's brand page shows. */
export interface BrandPage {
  brand: BrandKit;
  logoUrl: string | null;
  products: { product: Omit<Product, "photos"> & { photos: Viewable<ProductPhoto>[] }; facts: Fact[]; truthSheet: TruthSheet | null }[];
  batches: Batch[];
}

/** What the dashboard's taste page shows. */
export interface TastePage {
  canon: CanonVersion;
  versions: Omit<CanonVersion, "text">[];
  log: TasteEntry[];
  swipe: SwipeItem[];
}
