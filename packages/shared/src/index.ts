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

/** One font file of a brand, in the private store. */
export interface FontFile {
  family: string;
  weight: number;
  key: string;
  /** Where the file was copied from. */
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
  /** The font files the studio holds for this brand: the words of an ad are set in them. */
  fontFiles?: FontFile[];
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
  /** `pack` shows the product as sold. `food` shows the brand's own photo of the food itself. `prop` is a real photo of another thing a picture shows. */
  kind: "pack" | "food" | "prop";
  /** What the photo shows, when the product has more than one of its kind: "mango slice", "a real chilli padi". */
  what?: string;
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
  /** The owner approved the words. Only a batch whose kind has words passes through it. */
  "worded",
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

/** `v1`: the picture carries the logo and no words. `v2` and `v3`: a headline and a subline are set on it. */
export const BATCH_KINDS = ["v1", "v2", "v3"] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

export const FUNNEL_STAGES = ["tof", "mof", "bof"] as const;
/** Top, middle and bottom of the funnel. */
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface Batch {
  id: string;
  /** The kind of ad the batch makes. The owner names it at the start. */
  kind: BatchKind;
  /** A batch made to try the studio, set at its start and never after. The picks and the approvals in it are the tester's: they teach the studio nothing, and the batch is never a deliverable. */
  test?: true;
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
  /** The funnel stage the ad is for. An idea of a kind with words has one. */
  stage?: FunnelStage;
  /** The words set on the picture. An idea of a kind with words has both. */
  headline?: string;
  subline?: string;
  /** One other headline, as an option for the owner. */
  altHeadline?: string;
  /** Each claim the words make, with the saved fact that proves it. */
  claims?: { text: string; factId: string }[];
  /** A claim's source line, set small at the bottom of the picture. */
  footnote?: string;
  /** The product's real photos of each brand item the picture shows: "pack-1", "food-2". */
  shows?: string[];
}

/** The words the owner approved for one idea. They are set on its pictures and reused word for word. */
export interface ApprovedCopy {
  ideaId: string;
  headline: string;
  subline: string;
  footnote?: string;
  /** What the owner said when he approved, in his own words. */
  ownerSaid: string;
  /** 1 for the first approval. Each change he approves adds one. */
  version: number;
  at: string;
  by: string;
}

/** The blind critic's choice of the idea for one funnel stage, or its refusal of every idea of that stage. */
export interface StagePick {
  stage: FunnelStage;
  ideaId: string | null;
  reason: string;
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

/** One batch in the dashboard's list, with the names of its brand and product. */
export interface BatchSummary {
  batch: Batch;
  brand: { id: string; name: string };
  product: { id: string; name: string };
}

/** What the dashboard's taste page shows. */
export interface TastePage {
  canon: CanonVersion;
  versions: Omit<CanonVersion, "text">[];
  log: TasteEntry[];
  swipe: SwipeItem[];
}

/** What a picture of a batch is: the skeleton a draft is built round, a draft, a final, or what a pixel tool made from one. */
export type ImageKind =
  | "skeleton"
  | "draft"
  | "final"
  | "reprint"
  | "swap"
  | "finish"
  | "food_crop"
  /** A picture with the approved words and the real logo set on it. */
  | "typeset"
  /** A repair of a draft or a final: food colour, the pack's light, a box's print. */
  | "grade"
  | "relight"
  | "box_print"
  /** The pack photo padded to 4:5, and the open pack built from the model's edit of it. */
  | "pack_pad"
  | "pack_open";

/** A picture that a batch owns. It lives in the private picture store. */
export interface BatchImage {
  id: string;
  batchId: string;
  kind: ImageKind;
  key: string;
  ideaId?: string;
  /** The picture this one was made from: a draft's skeleton, a final's draft. */
  fromId?: string;
  /** The draft or the final that a repair, a finish or a food crop stands for. */
  rootId?: string;
  /** For a picture with the words set on it: the version of the approved words it carries. */
  wordsVersion?: number;
  createdAt: string;
}

export type RenderKind = "draft" | "final";

/** One request to the picture model, from the moment it is sent. */
export interface Render {
  id: string;
  batchId: string;
  ideaId: string;
  kind: RenderKind;
  status: "queued" | "done" | "failed";
  prompt: string;
  /** A draft's skeleton, or the picked draft of a final. */
  fromId?: string;
  /** The price held for it in the ledger, in US dollars. */
  usd: number;
  /** The picture it made. */
  imageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A defect (D) rejects a picture by itself. Two faults (F) do the same. */
export type CheckCode = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9" | "D10" | "D11" | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8";

export interface CheckItem {
  code: CheckCode;
  /** What is wrong in this picture, in a line. */
  note: string;
  /** The pixel tool that measured it. An item with a tool was measured, and no agent can remove it. */
  tool?: string;
}

/** What was found in one draft or one final. No item means it was looked at and nothing was found. */
export interface ImageChecks {
  imageId: string;
  items: CheckItem[];
  /** True when the agent has saved its own look at the picture. Measured items can arrive before that. */
  looked: boolean;
  savedAt: string;
}

/** The owner's choice for one idea: one of its drafts, or none of them. */
export interface Pick {
  ideaId: string;
  /** The picked draft's picture, or null when the owner passed on all of the idea's drafts. */
  imageId: string | null;
  /** The picture he looked at when he picked: the draft, or its newest repair. */
  shownId?: string;
  ownerSaid: string;
  at: string;
  by: string;
  /** His first choice for this idea, when a later one replaced it. Only the first is made before he sees the critic's rank. */
  first?: { imageId: string | null; shownId?: string; at: string };
}

export interface BoardDraft {
  /** 1 to 3, in the order the drafts were sent. It is a name, not a rank. */
  number: number;
  /** The picture as the model made it. A pick names this one. */
  image: BatchImage;
  /** The picture that counts: the newest repair of it (a reprint or a swap), or the picture itself. */
  shown: BatchImage;
  /** Opens `shown`. */
  viewUrl: string;
  /** The D and F items found in `shown`, or null when it has not been checked yet. */
  checks: ImageChecks | null;
  /** A final after the real-camera finish: the picture that is delivered. */
  finish?: { image: BatchImage; viewUrl: string };
  /** The picture with the approved words and the real logo set on it (an ad with words): what the owner judges, and what is delivered. */
  words?: { image: BatchImage; viewUrl: string; /** The agent's look at the picture with its words. Null until it is saved. */ checks: ImageChecks | null };
}

export type PixelTool =
  | "skeleton"
  | "reprint"
  | "swap"
  | "pack_check"
  | "cap_check"
  | "photo_finish"
  | "food_crop"
  | "headline"
  | "food_grade"
  | "relight"
  | "box_print"
  | "pack_pad"
  | "pack_open";

/** One run of a pixel tool, from the moment it is sent. */
export interface PixelJob {
  id: string;
  batchId: string;
  tool: PixelTool;
  status: "queued" | "done" | "failed";
  /** The picture the tool worked on. */
  imageId?: string;
  /** What the tool said: a measure, or what it made. */
  line?: string;
  /** For a check: whether the picture passed. */
  passed?: boolean;
  /** The picture the tool made. */
  madeId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the owner sees to pick: each idea's drafts beside the product's truth sheet, with no rank. */
export interface Board {
  batch: Batch;
  /** Whether the owner can pick now: `not_yet` until every draft is made and checked, `closed` once the finals are finished. */
  picking: "not_yet" | "open" | "closed";
  brand: { id: string; name: string };
  product: { id: string; name: string };
  truthSheet: TruthSheet | null;
  ideas: {
    idea: Idea;
    /** The words the owner approved for this idea (an ad with words). */
    copy?: ApprovedCopy;
    drafts: BoardDraft[];
    pick: Pick | null;
    /** The blind critic's rank of this idea's drafts. Null until the owner has picked or passed, so that it cannot lead him. */
    rank: CriticRank | null;
    finals: BoardDraft[];
  }[];
}

/** The blind critic's order of one idea's drafts, best first, with a reason for each place. */
export interface CriticRank {
  ideaId: string;
  /** shownId is the picture the critic looked at: the draft or its newest repair, and in an ad with words that picture with its words. The server sets it. */
  order: { imageId: string; shownId: string; reason: string }[];
  at: string;
}

/** The blind critic's word on one idea: keep it, or cut it and have another written. */
export interface IdeaVerdict {
  ideaId: string;
  verdict: "keep" | "cut";
  reason: string;
}

/** A share of n, with the 95% interval it could lie in. Under 30 it shows a direction only. */
export interface Share {
  k: number;
  n: number;
  value: number | null;
  interval: [number, number] | null;
  note?: string;
}

/** What the dashboard's calibration page shows: does the blind critic agree with the owner? */
export interface CalibrationPage {
  /** How often the owner picked the draft that the blind critic had put first, and the place of each draft he picked. */
  picks: { firstPlace: Share; byPlace: Record<string, number> };
}

/** One condition of the done gate, with what the studio measured. */
export interface DoneCondition {
  name: "picks" | "finals" | "words";
  /** The condition in the owner's words. */
  asks: string;
  passed: boolean;
  evidence: string;
}

export interface DoneReport {
  batch: Batch;
  done: boolean;
  conditions: DoneCondition[];
  /** What the studio cannot measure. The owner judges these himself. */
  strangerTest: string[];
}

/** An ad the owner holds up as the bar. A writer and a critic look at it before they judge new work. */
export interface Reference {
  id: string;
  /** The kinds of ad it is a reference for. */
  kinds: BatchKind[];
  brand: string;
  /** The ad's headline, or a short name for an ad with no words. */
  title: string;
  /** What the ad does, in one or two lines. */
  why: string;
  /** True for an example of "usable", not a template: new work is free to go elsewhere. */
  loose?: boolean;
  picture: PictureRef;
  addedAt: string;
  savedBy: string;
}
