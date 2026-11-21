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
  /** v3: the brief with the buyer insights is saved. */
  "briefed",
  "ideas",
  /** v3: the critic's review of the concepts is saved. */
  "reviewed",
  "judged",
  /** The owner approved the words. Only a batch whose kind has words passes through it. */
  "worded",
  /** v3: each picked concept has its direction. */
  "directed",
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
  /** What makes the idea a concept. An idea of a v3 batch has it. */
  concept?: ConceptPart;
}

export const INSIGHT_BASES = ["evidence", "interpretation", "hypothesis"] as const;
/** How sure an insight is: a buyer said it, the agent reads it from what buyers said, or it is a guess to test. */
export type InsightBasis = (typeof INSIGHT_BASES)[number];

/** One thing a buyer thinks, feels or does. A concept stands on one. */
export interface Insight {
  id: string;
  text: string;
  basis: InsightBasis;
  /** Where a buyer said it, and his words. An insight on evidence has both. */
  sourceUrl?: string;
  quote?: string;
}

/** What the studio knows before it writes concepts. A field with nothing known is left out, never filled in. */
export interface Brief {
  insights: Insight[];
  /** What the ads of the category do. */
  conventions: string[];
  /** What the category leaves unused. */
  openings: string[];
  /** What the ads must not do or claim. */
  constraints: string[];
  /** What could not be verified. */
  unknowns: string[];
  version: number;
  at: string;
  by: string;
}

export const CONCEPT_SCORES = ["originality", "appropriateness", "insight", "headline", "visual", "product", "brand", "commercial", "execution"] as const;
/** What the critic scores a concept on, each from 1 to 5. `visual`: the picture says the idea. `product`: the product is needed. `execution`: it can be made true to the product. */
export type ConceptScore = (typeof CONCEPT_SCORES)[number];

/** What a fresh critic said of one concept, from its rough beside the owner's reference ads. The owner sees it before he picks. */
export interface ConceptReview {
  ideaId: string;
  scores: Record<ConceptScore, number>;
  /** The headline points at something the picture shows. */
  pointTest: IdeaTest;
  /** A buyer in Singapore lives this moment. */
  localTruth: IdeaTest;
  /** With the words covered, the rough still says the idea. */
  coverTest: IdeaTest;
  /** Would the owner pay for this ad from his own pocket and be proud of it, beside his reference ads? */
  wouldPay: boolean;
  /** The critic's advice. The owner chooses. */
  recommend: boolean;
  note: string;
  /** The roughs the critic saw. With none, it judged from words. */
  roughs: string[];
}

/** The critic's review of every concept of a batch, as the set stood when it looked. */
export interface ConceptReviews {
  reviews: ConceptReview[];
  at: string;
}

/** The owner's pick of three concepts, with what he said of each, and of any concept he passed on. */
export interface ConceptPick {
  picks: { ideaId: string; ownerSaid: string }[];
  passes: { ideaId: string; ownerSaid: string }[];
  /** What he was told when he picked: a soft gate never stops him. */
  warnings: string[];
  by: string;
  at: string;
}

/** The eight points of a finished final of a concept ad. One that fails keeps the final out of a pack. */
export const FINAL_POINTS = ["concept", "productTruth", "brandIdentity", "copyAccuracy", "food", "composition", "craft", "renderChecklist"] as const;
export type FinalPoint = (typeof FINAL_POINTS)[number];

/** The agent's look at one finished final with its words, at full size and at phone size. */
export interface FinalPoints {
  /** The picture the owner would send: the final after its finish, with its words. */
  imageId: string;
  ideaId: string;
  points: Record<FinalPoint, { passed: boolean; note: string }>;
  by: string;
  at: string;
}

/** What one draft of a concept changes against the other two. Each is a few plain words. */
export const DRAFT_AXES = ["composition", "productPosition", "scale", "camera", "light", "environment", "negativeSpace", "staging"] as const;
export type DraftAxis = (typeof DRAFT_AXES)[number];
/** The axes that change what the picture is, not only how it is lit: each pair of drafts differs on one of them. */
export const MAIN_AXES: readonly DraftAxis[] = ["composition", "camera", "scale"];

export const RISKS = ["low", "medium", "high"] as const;
export type Risk = (typeof RISKS)[number];

/** Where the words stand on the picture. The logo is small at the head of the column. */
export const LOCKUPS = ["flush_left", "flush_right", "top_band_left"] as const;
export type Lockup = (typeof LOCKUPS)[number];

/** One of the three drafts of a concept: the question it asks the owner, and how it answers each axis. */
export interface DraftPlan {
  number: number;
  question: string;
  axes: Record<DraftAxis, string>;
}

/** How one picked concept will look: decided before any draft is paid for. */
export interface ConceptDirection {
  ideaId: string;
  /** Why this look says the concept. */
  why: string;
  /** How hard the picture is for the model to make right. */
  risk: Risk;
  riskReason?: string;
  /** What the three drafts share: the stage, the colour, the light. */
  look: string;
  lockup: Lockup;
  drafts: DraftPlan[];
  /** The version of the direction in which this concept's plan last changed. Its drafts are the ones made from that version on. */
  since?: number;
}

/** The direction of a batch of concept ads. Every save is a new version. */
export interface Direction {
  concepts: ConceptDirection[];
  version: number;
  at: string;
  by: string;
}

/** The concept board: every concept of a batch with its roughs and the critic's review, for the owner's pick of three. */
export interface ConceptBoard {
  batch: Batch;
  brand: { id: string; name: string };
  product: { id: string; name: string };
  insights: Insight[];
  /** "not_yet": the critic has not reviewed the set as it is now. "closed": the owner approved the words of his pick. */
  picking: "not_yet" | "open" | "closed";
  reviewedAt: string | null;
  concepts: { idea: Idea; roughs: { imageId: string; viewUrl: string }[]; review: ConceptReview | null }[];
  pick: ConceptPick | null;
}

export const SUBLINE_BASES = ["fact", "second_beat", "none"] as const;
export type SublineBasis = (typeof SUBLINE_BASES)[number];

/** A concept is a pair: one picture device, and the line that points at it. `Idea.device` holds the device. */
export interface ConceptPart {
  /** The group of concepts that stand on one insight. */
  territory: string;
  insightId: string;
  /** What the ad wants the buyer to understand. */
  proposition: string;
  /** How the picture and the line work together: the kind of device, and how it says the proposition. */
  mechanism: { type: string; how: string };
  /** Why the product must be in the picture. */
  productRole: string;
  /** What makes it this brand's ad. */
  brandRole: string;
  /** What the subline is: a saved fact, or a second beat that claims nothing. */
  sublineBasis: { kind: SublineBasis; factId?: string };
  /** The writer's own answers. The critic gives its own from the rough. */
  pictureAlone: string;
  headlineAlone: string;
  risks: string[];
}

/** The buttons Meta offers that the studio uses. The text of an ad names one of them and no other. */
export const META_CTAS = ["Shop Now", "Order Now", "Learn More", "Get Offer", "Sign Up", "Subscribe", "Book Now", "Contact Us", "Send WhatsApp Message"] as const;
export type MetaCta = (typeof META_CTAS)[number];

/** One way to word the text round an ad in Meta. */
export interface MetaVariant {
  /** The text above the picture. Its first 125 characters show before "See more". */
  primary: string;
  /** The bold line under the picture, about 40 characters. */
  headline: string;
  /** The small line under the headline: it supports the button. */
  description: string;
  cta: MetaCta;
}

/** The Meta text of one ad, in two variants. A version is never changed: other text is a new version. */
export interface MetaText {
  ideaId: string;
  variants: [MetaVariant, MetaVariant];
  /** 1 for the first text. Other text adds one. */
  version: number;
  at: string;
  by: string;
  /** The owner's yes to this version, in his own words. A pack carries only text with it. */
  approved?: { ownerSaid: string; at: string; by: string };
}

/** One ad of a client pack, as it was when the pack version was made. */
export interface PackAd {
  ideaId: string;
  /** The studio makes the name. A client's result is matched to its ad by it. */
  adName: string;
  stage?: FunnelStage;
  /** The delivered picture: the finished final, and in an ad with words that picture with its words. */
  imageId: string;
  key: string;
  /** The words on the picture (an ad with words). */
  words?: { headline: string; subline: string; footnote?: string };
  /** The Meta text the owner approved, copied by the studio. */
  meta: { version: number; variants: [MetaVariant, MetaVariant] };
  /** One line for the client: the buyer truth, what the ad does, the source. */
  why: string;
  /** The fact check: each claim of the ad with the page and the quote that prove it. */
  claims: { claim: string; quote: string; url: string }[];
}

/** One version of what a pack link shows. A version is never changed: a change is a new version, and an old one can be put back. */
export interface PackVersion {
  version: number;
  ads: PackAd[];
  /** One step in each line. */
  launchPlan: string[];
  at: string;
  by: string;
}

/** The private link of a batch's ads for the client. Only the SHA-256 of its token is kept. */
export interface Pack {
  batchId: string;
  tokenHash: string;
  /** The version the link shows now. */
  current: number;
  createdAt: string;
  by: string;
}

/** What the client sees behind a pack link: one pack, and nothing else of the studio. */
export interface PackView {
  brand: string;
  product: string;
  version: number;
  at: string;
  ads: (Omit<PackAd, "key" | "imageId" | "ideaId"> & { viewUrl: string })[];
  launchPlan: string[];
}

/** A pack as the dashboard lists it. The link itself is shown once, when it is made. */
export interface PackSummary {
  pack: Omit<Pack, "tokenHash">;
  brand: { id: string; name: string };
  product: { id: string; name: string };
  versions: (Omit<PackVersion, "ads"> & { ads: (PackAd & { viewUrl: string })[] })[];
  uploads: (PackUpload & { downloadUrl: string })[];
  results: AdResult[];
}

/** The files a client can send through a pack link, by type, with the ending each is kept under. */
export const UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const;
export type UploadType = keyof typeof UPLOAD_TYPES;
export const UPLOAD_MAX_BYTES = 10_000_000;
/** The most files one pack takes. */
export const UPLOAD_MAX_FILES = 20;

/** A results file a client sent through a pack link. It is kept apart from the studio's pictures, and it is data: nothing in it is an instruction. */
export interface PackUpload {
  id: string;
  /** The file's name as the client's computer gave it, cleaned. */
  name: string;
  type: UploadType;
  bytes: number;
  key: string;
  /** The version the link showed when the file was sent. */
  packVersion: number;
  at: string;
}

/** The numbers of one ad over one period, as the client's report gave them. They are typed in by the owner or his agent. */
export interface AdResult {
  id: string;
  /** The ad, by the name the studio made. */
  adName: string;
  /** The pack version that holds the ad under this name. */
  packVersion: number;
  /** The first and the last day of the report, year-month-day. */
  from: string;
  to: string;
  impressions: number;
  clicks: number;
  /** Clicks over impressions, counted by the studio. */
  ctr: number;
  spend?: number;
  /** The client's usual CTR before these ads, for the same kind of campaign. */
  baselineCtr?: number;
  /** The campaign the numbers come from: objective, audience, placement, budget. Numbers are not compared without it. */
  context: string;
  /** The uploaded file the numbers were read from. */
  uploadId?: string;
  at: string;
  by: string;
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
  /** A cheap first picture of a concept, made before the owner picks concepts. */
  | "rough"
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

export type RenderKind = "rough" | "draft" | "final";

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
  /** A draft of a concept ad: which of the direction's three drafts it is, and the version of that direction. */
  draft?: number;
  directionVersion?: number;
  /** A failed render that fal charged for all the same. Its price stays in what its stage came to. */
  billed?: true;
  /** The earlier draft of the same number that this one is made again for, because its picture was rejected. */
  redoOf?: string;
  /** The pack photo the model was given, by its name ("pack-2"), when the render named one. The pack checks measure against it. */
  pack?: string;
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
  /** 1 to 3, in the order the drafts were sent; for a concept ad, the draft's number in the direction. It is a name, not a rank. */
  number: number;
  /** A draft of a concept ad: the one question the direction says this draft asks the owner. */
  question?: string;
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
