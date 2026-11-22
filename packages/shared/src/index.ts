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
  /** The call belongs to the outreach campaign: it is in the campaign's total, not in the month's. */
  campaign?: true;
}

export interface SpendSummary {
  /** The calendar month, in UTC, as YYYY-MM. */
  month: string;
  monthUsd: number;
  monthCapUsd: number;
  batchCapUsd: number;
  batchId?: string;
  batchUsd?: number;
  /** The outreach campaign: counted apart from the month, against its own cap. */
  campaign: { usd: number; capUsd: number; batchCapUsd: number };
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
/** What a canon rule is about. The owner's taste holds for every brand; a brand's canon holds only for that brand. */
export const CANON_SCOPES = ["owner", "brand", "craft", "performance"] as const;
export type CanonScopeKind = (typeof CANON_SCOPES)[number];
export interface CanonScope {
  kind: CanonScopeKind;
  /** Only for the scope of a brand. */
  brandId?: string;
}

/** Something the studio saw and what it may teach. It proposes; it never changes a product fact or the canon. */
export interface LearningRecord {
  id: string;
  observation: string;
  /** Where it was seen: the owner's words, a batch, a results file. */
  source: string;
  scope: CanonScope;
  lesson: string;
  /** How many separate times it was seen. */
  evidence: number;
  confidence: "low" | "medium" | "high";
  examples: string[];
  counterexamples: string[];
  expectedEffect: string;
  testResult?: string;
  batchId?: string;
  savedBy: string;
  savedAt: string;
}

/** A change to a canon that waits for the owner. It is not active until he says yes. */
export interface CanonProposal {
  id: string;
  scope: CanonScope;
  /** The whole canon of that scope as it would read. */
  text: string;
  reason: string;
  /** The learning records it rests on. */
  recordIds: string[];
  /** The version of that canon the proposal was written against. */
  baseVersion: number;
  status: "proposed" | "approved" | "declined";
  proposedBy: string;
  proposedAt: string;
  decidedAt?: string;
  ownerSaid?: string;
  /** The canon version an approval made. */
  version?: number;
}

/** What the owner chose for one brand, in his words (for example the cap, not the pump). The next batch of that brand gets it. */
export interface BrandNote {
  id: string;
  brandId: string;
  note: string;
  ownerSaid: string;
  batchId?: string;
  savedBy: string;
  at: string;
}

export interface CanonVersion {
  /** No scope means the owner's taste. */
  scope?: CanonScope;
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
  /** A batch that makes one ad for a brand of the outreach list, set at its start and never after. The agent chooses in the owner's place in it, so it teaches the studio nothing; it is done with one final, and it makes no client pack. */
  purpose?: "outreach";
  /** The prospect an outreach batch makes its ad for. */
  prospectId?: string;
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
  /** The pictures a download gives, when they are not the picture the page shows: the marked copies of an example. */
  downloads?: { key: string; type: PackPictureType }[];
}

/** One pack on a client's page. `ref` names the pack on that page only: it is no id of the studio. */
export interface ClientPack extends PackView {
  ref: string;
}

/** What a client's link shows: every pack of that one brand, newest first, each at the version its own link shows. */
export interface ClientView {
  brand: string;
  packs: ClientPack[];
}

/** A client's link as the owner sees it. The link itself is not kept: only the hash of its token. */
/** One pack as the owner's Clients page shows it: what the client sees, what the client wrote and what the client sent. */
export interface OwnerClientPack {
  packId: string;
  product: string;
  version: number;
  at: string;
  /** True for the example: it takes no comment and no file. */
  example: boolean;
  ads: { adName: string; viewUrl: string }[];
  /** Every comment, hidden ones too, oldest first. */
  comments: PackComment[];
  uploads: PackSummary["uploads"];
}

export interface OwnerClient {
  brand: { id: string; name: string };
  /** The client's link, when one was ever made. The link itself is shown once, when it is made. */
  link?: ClientLink;
  packs: OwnerClientPack[];
}

export interface ClientLink {
  brandId: string;
  state: "on" | "off";
  /** When the link that works now was made, or when it was turned off. */
  at: string;
  by: string;
}

/** The picture types a pack's download gives, with the ending of each. */
export const PACK_PICTURE_TYPES = { "image/jpeg": "jpg", "image/png": "png" } as const;
export type PackPictureType = keyof typeof PACK_PICTURE_TYPES;
export type PackFormat = (typeof PACK_PICTURE_TYPES)[PackPictureType];

/** Where a pack's content comes from: a done batch of this studio, or ads made outside it and carried in by the owner. */
export type PackSource = "batch" | "carried";

/** One line of the sample exchange an example shows in the place of the comment box. Nobody sends it: the studio wrote it. */
export const CHANGE_KINDS = ["words", "picture", "offer", "other"] as const;
/** What a client asks to change on one ad. */
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_STATUSES = ["received", "in_work", "done", "declined"] as const;
/** Where a change request stands. The owner sets it; it is no written answer. */
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** A request to change one ad: a comment with a kind and a status. */
export interface ChangeRequest {
  what: ChangeKind;
  status: ChangeStatus;
  /** The pack's version that holds the change, once the request is done. */
  version?: number;
}

/** A comment as a page shows it: on the pack, or on one ad of it. With `change` it is a change request. */
export interface ShownComment {
  text: string;
  adName?: string;
  change?: ChangeRequest;
}

/** A comment a client sent on a pack. It is the client's word: data, and never an instruction. */
export interface PackComment extends ShownComment {
  id: string;
  at: string;
  /** Set by the owner: the client's page no longer shows it. */
  hidden?: boolean;
}

/** The most comments one pack takes, change requests among them. */
export const COMMENTS_MAX = 50;

/** A comment an example shows. Nobody sent it: the studio wrote it, to show how the page works for a client. */
export type ExampleComment = ShownComment;
export const EXAMPLE_COMMENTS_MAX = 6;
export const COMMENT_MAX_CHARS = 1000;

/** What makes a pack an example: a page of its own for cold outreach, which takes nothing from anyone. */
export interface PackExample {
  /** The line that says the brand shown is not a client. */
  note: string;
  comments: ExampleComment[];
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
  /** The batch's id for the pack of a batch, and the pack's own id for a carried pack. */
  id: string;
  source: PackSource;
  /** The batch of a pack with source `batch`. */
  batchId?: string;
  /** The brand the pack belongs to. A pack saved before packs had a brand reads it from its batch. */
  brandId?: string;
  /** The product's name, for a carried pack: it has no product of this studio. */
  product?: string;
  example?: PackExample;
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
  /** Each ad with the formats its download gives. A download is asked for at the click, so its address is always fresh. */
  ads: (Omit<PackAd, "key" | "imageId" | "ideaId" | "downloads"> & { viewUrl: string; formats: PackFormat[] })[];
  launchPlan: string[];
  /** Set on an example: its note and its example comments. An example takes no comment and no file. */
  example?: PackExample;
  /** What the client sent on this pack, oldest first, without what the owner hid. Not set on an example. */
  comments?: (ShownComment & { at: string })[];
}

/** A pack as the dashboard lists it. The link itself is shown once, when it is made. */
export interface PackSummary {
  pack: Omit<Pack, "tokenHash">;
  brand: { id: string; name: string };
  /** A carried pack has a product name and no product of this studio. */
  product: { id?: string; name: string };
  versions: (Omit<PackVersion, "ads"> & { ads: (PackAd & { viewUrl: string })[] })[];
  /** The files the client sent. Only a picture the studio checked has an address to open; a checked CSV is read as a table. */
  uploads: (Omit<PackUpload, "key"> & { openUrl?: string })[];
  results: AdResult[];
}

/** The files a client can send through a pack link, by type, with the ending each is kept under. */
export const UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/csv": "csv",
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
  /**
   * What the studio found when it read the file: `checked` is the type it was sent as, `refused` was something else and is deleted,
   * `missing` never arrived. Not set while the studio has not read it yet. Only a checked file can be opened.
   */
  state?: UploadState;
}

export type UploadState = "checked" | "refused" | "missing";

/** A client's CSV as the dashboard shows it: text in rows, cut to a size a page can hold. It is never opened as a file. */
export interface UploadTable {
  rows: string[][];
  /** True when the file held more rows, columns or characters than the table shows. */
  cut: boolean;
}
export const TABLE_MAX_ROWS = 500;
export const TABLE_MAX_COLUMNS = 60;
export const TABLE_MAX_CELL = 300;
/** The most characters one table holds, all cells together, so one answer of the studio stays small enough to send. */
export const TABLE_MAX_CHARS = 500_000;

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
  /** The rules of this brand alone. Version 0 with no text when there are none. */
  canon: CanonVersion;
  canonVersions: Omit<CanonVersion, "text">[];
  /** What the owner chose for this brand before, newest first. */
  notes: BrandNote[];
}

/** What the dashboard's taste page shows. */
export interface TastePage {
  canon: CanonVersion;
  versions: Omit<CanonVersion, "text">[];
  log: TasteEntry[];
  swipe: SwipeItem[];
  /** The other canons: creative craft, performance, and each brand that has one. */
  canons: ScopedCanon[];
  /** The proposed changes, newest first. One with the status proposed waits for the owner. */
  proposals: ProposalView[];
  /** What the studio saw, newest first. A record is not a rule. */
  learning: (LearningRecord & { scopeName: string })[];
}

/** A canon other than the owner's taste, as the dashboard shows it. */
export interface ScopedCanon {
  scope: CanonScope;
  /** "Creative craft", "Performance", or the brand's name. */
  name: string;
  canon: CanonVersion;
  versions: Omit<CanonVersion, "text">[];
}

/** A proposed change with what it would replace. */
export interface ProposalView extends CanonProposal {
  scopeName: string;
  /** The canon of its scope as it reads now. */
  current: CanonVersion;
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

/** The spend tiers of the owner's outreach list, by live Meta ads. */
export const OUTREACH_TIERS = ["20+", "5-19", "<5"] as const;
export type OutreachTier = (typeof OUTREACH_TIERS)[number];

export const OUTREACH_STAGES = ["new", "no_route", "needs_service_ad", "pick_waits", "pick_made", "ad_waits", "ready", "contacted", "replied", "in_talks", "client", "lost", "parked", "opted_out"] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];

export type OutreachChannel = "whatsapp" | "email";
/** The three messages of the sequence: the first message, follow-up 1, follow-up 2. */
export type OutreachStep = 0 | 1 | 2;

/** One brand of the owner's outreach list, as the list gives it. Only the load writes it. */
export interface Prospect {
  id: string;
  /** Its number in the list: the owner's order of priority. */
  n: number;
  brand: string;
  sector: string;
  liveAds: number;
  tier: OutreachTier;
  /** The day of its newest ad, as YYYY-MM-DD. */
  newestAd?: string;
  bestRoute?: string;
  secondRoute?: string;
  /** WhatsApp numbers: digits only, with the country code. */
  whatsapp: string[];
  /** A verified address, in lower case. */
  email?: string;
  phone?: string;
  instagram?: string;
  decisionMaker?: string;
  dmTitle?: string;
  linkedin?: string;
  /** Made to try the pages. It is left out of every number and every limit, and it can be removed. */
  test?: true;
  loadedAt: string;
}

/** What an agent may read of a prospect: nothing that reaches a person. */
export interface ProspectBrief {
  id: string;
  n: number;
  brand: string;
  sector: string;
  liveAds: number;
  tier: OutreachTier;
  newestAd?: string;
  instagram?: string;
}

/** A finished outreach ad, attached to its prospect. */
export interface OutreachAd {
  /** 1 for the prospect's first ad. */
  n: number;
  /** The outreach batch that made it. `owner` for a picture the owner uploaded himself. */
  batchId: string;
  imageId: string;
  /** Missing for a picture the owner uploaded: it came from no batch. */
  kind?: BatchKind;
  /** Set when the owner uploaded the picture from his computer. His upload is his yes. */
  from?: "owner";
  /** Set when the ad is the final of the draft the owner picked on the prospect's page. His pick is his yes. */
  picked?: true;
  /** Where the studio's own copy of the final sits in the private store. */
  key: string;
  /** One line from the agent: what the ad shows and why it fits the brand. */
  why: string;
  /** What the checks found in this final, in plain words: it blocked nothing, and the owner reads it before he sends. */
  warning?: string;
  at: string;
}

/** The picture types the owner may upload for a prospect, and the ending of each. */
export const OWN_PICTURE_TYPES = { "image/jpeg": "jpg", "image/png": "png" } as const;
export type OwnPictureType = keyof typeof OWN_PICTURE_TYPES;
/** The largest picture the owner may upload for a prospect, in bytes. */
export const OWN_PICTURE_MAX_BYTES = 8_000_000;

/** A message the owner sent by hand and marked as sent, with the exact text. */
export interface OutreachSend {
  step: OutreachStep;
  /** The Singapore day, as YYYY-MM-DD. */
  day: string;
  channel: OutreachChannel;
  title: string;
  text: string;
  at: string;
}

export type OutreachEventBody =
  | { type: "kind"; kind: "product" | "service" }
  /** `auto` takes a set stage away again: the stage then comes from the history. */
  | { type: "stage"; stage: "in_talks" | "client" | "lost" | "parked" | "auto"; reason?: string }
  | { type: "ad_yes"; ad: number }
  | { type: "ad_no"; ad: number; ownerSaid: string }
  /** The drafts of an outreach batch are ready for the owner's look on the prospect's page. */
  | { type: "candidates"; batchId: string; /** How many drafts he can pick from. */ drafts: number }
  /** The owner chose the draft to send. The agent then makes its final. */
  | { type: "pick"; batchId: string; ideaId: string; imageId: string }
  /** The owner wants none of the drafts of a batch. It counts as a no. */
  | { type: "none"; batchId: string; ownerSaid: string }
  /** The owner wants one draft with other words. The agent sets them and shows the drafts again. */
  | { type: "words"; batchId: string; ideaId: string; imageId: string; ownerSaid: string }
  | { type: "reply"; reply: "more" | "no" | "other"; text?: string }
  | { type: "answered" }
  | { type: "optout" }
  | { type: "unsent"; step: OutreachStep }
  | { type: "note"; text: string }
  | { type: "channel"; channel: OutreachChannel }
  /** The owner chose to send to a prospect that shares its contact with an earlier one. */
  | { type: "chosen" };

export type OutreachEvent = OutreachEventBody & { id: string; at: string; by: "owner" | "agent" };

/** A prospect with everything that happened to it. */
export interface ProspectFile {
  profile: Prospect;
  ads: OutreachAd[];
  sends: OutreachSend[];
  events: OutreachEvent[];
}

/** One message of the owner's sequence: two versions of its title, and its text. `{Brand}` is the only placeholder. */
export interface OutreachTemplate {
  titles: [string, string];
  body: string;
}

/** The owner's three messages, in his words. Only he changes them. */
export interface OutreachTemplates {
  steps: [OutreachTemplate, OutreachTemplate, OutreachTemplate];
  savedAt: string;
}

/** A message with the brand's name filled in, and the link that opens it in WhatsApp or the mail program. */
export interface OutreachMessage {
  title: string;
  text: string;
  /** Missing when the brand has no checked contact for its channel. */
  href?: string;
}

/** One prospect as a line of a list. It holds no number and no address. */
export interface ProspectRow {
  id: string;
  n: number;
  brand: string;
  sector: string;
  liveAds: number;
  tier: OutreachTier;
  stage: OutreachStage;
  channel?: OutreachChannel;
  /** True when a new ad waits for the owner's yes or no. */
  adWaits: boolean;
  /** The next message of the sequence and the day it is due. */
  next?: { step: OutreachStep; due: string };
  /** The brand earlier in the list that has the same number or address. */
  sameContactAs?: string;
  test?: true;
}

/** An outreach ad with a short-lived address of its picture. */
export interface OutreachAdView extends OutreachAd {
  viewUrl: string;
  /** The same picture as a file to save. */
  downloadUrl: string;
  verdict?: "yes" | "no";
}

/** One line of the Today page: a brand, its ad and the message to send. */
export interface TodayLine {
  prospect: ProspectRow;
  /** The ad the message carries, or the ad that waits for a yes or a no. */
  ad?: OutreachAdView;
  /** The message this line is about. Missing for an ad that waits. */
  step?: OutreachStep;
  /** Both versions of the message, with the link of the brand's channel. */
  messages?: [OutreachMessage, OutreachMessage];
  /** The reply that is owed an answer. */
  reply?: { text?: string; at: string };
  /** How many drafts wait for the owner's pick on the prospect's page. */
  drafts?: number;
}

export interface TodayPage {
  /** The Singapore day, as YYYY-MM-DD. */
  day: string;
  /** Whether today is a planned sending day: a weekday that is no public holiday. The owner can send on any day. */
  sendingDay: boolean;
  nextSendingDay: string;
  /** The daily number of first messages, and how many are marked as sent today. */
  daily: number;
  firstsSent: number;
  /** False until the owner's message text is loaded. */
  templates: boolean;
  owed: TodayLine[];
  followUps: TodayLine[];
  firsts: TodayLine[];
  adsWaiting: TodayLine[];
  /** The brands whose drafts wait for the owner's pick. */
  picks: TodayLine[];
}

/** A count of prospects, also by spend tier and by the channel of the brand. */
export interface OutreachCount {
  all: number;
  byTier: Record<OutreachTier, number>;
  byChannel: Record<OutreachChannel, number>;
}

/** The numbers of the campaign. A test prospect is in none of them. */
export interface OutreachNumbers {
  prospects: number;
  sent: OutreachCount;
  replied: OutreachCount;
  saidMore: OutreachCount;
  optedOut: OutreachCount;
  clients: OutreachCount;
}

export interface ProspectsPage {
  numbers: OutreachNumbers;
  /** Every sector of the list, for the filter. */
  sectors: string[];
  /** The prospects the search and the filters leave, in list order. */
  rows: ProspectRow[];
}

/** How to reach a prospect. Only the owner's pages get it. A link is there only when the value passed its check. */
export interface ProspectContact {
  whatsapp: { number: string; href?: string }[];
  email?: { address: string; href?: string };
  phone?: string;
  instagram?: { name: string; href?: string };
  decisionMaker?: string;
  dmTitle?: string;
  linkedin?: { text: string; href?: string };
  bestRoute?: string;
  secondRoute?: string;
}

/** One prospect with everything about it, for the owner. */
export interface ProspectPage {
  prospect: ProspectRow;
  newestAd?: string;
  sells?: "product" | "service";
  contact: ProspectContact;
  /** Newest first. */
  ads: OutreachAdView[];
  sends: OutreachSend[];
  events: OutreachEvent[];
  /** The Singapore day: a mark of today can be taken back. */
  day: string;
  /** The message that can be sent now, in both versions. */
  message?: { step: OutreachStep; messages: [OutreachMessage, OutreachMessage] };
  /** A reply that waits for the owner's answer. */
  owed?: { text?: string; at: string };
  /** Every draft made for the brand, for the owner's pick. Missing when no outreach batch has drafts. */
  candidates?: OutreachCandidates;
}

/** One draft of an outreach batch as the owner sees it on the prospect's page. */
export interface OutreachCandidate {
  ideaId: string;
  title: string;
  /** The words on the picture (an ad with words). */
  headline?: string;
  subline?: string;
  /** The draft's number within its idea. A name, not a rank. */
  number: number;
  /** The picture a pick names. */
  imageId: string;
  viewUrl: string;
  /** Why this draft cannot be picked yet: it has no words, or he refused its full-size version. Never a check. */
  blocked?: string;
  /** What the checks found in this draft, in plain words: it blocks nothing, and the owner reads it before he picks. */
  warning?: string;
}

/** Every draft the studio made for a prospect's newest outreach batch, and what the owner chose. */
export interface OutreachCandidates {
  batchId: string;
  /** True when the pictures carry words and no full-size ad is made of them yet, so "other words" can be asked. */
  words: boolean;
  /** True when these drafts wait for his pick now, so "none of these" can be said. */
  waits: boolean;
  /** True when the agent owes him work on these drafts: the final of his pick, or the other words. */
  agentOwes: boolean;
  /** `open`: the owner can choose. `agent`: his choice is saved and the agent's work is owed. `closed`: the first message is sent, or the brand takes no ad. */
  choosing: "open" | "agent" | "closed";
  /** The draft he picked. */
  picked?: { ideaId: string; imageId: string };
  /** The words he asked for, not set yet. */
  wordsAsked?: { imageId: string; ownerSaid: string };
  drafts: OutreachCandidate[];
}

export interface TemplatesPage {
  templates?: OutreachTemplates;
  daily: number;
  dailyMin: number;
  dailyMax: number;
  /** The one placeholder a message may hold. */
  placeholder: string;
}

/** Who a batch waits for: the owner, an agent, or nobody when it is at its end. */
export type BatchWaitsFor = "owner" | "agent" | "nobody";

/** A batch as the start page shows it: where it stands, in plain words, and who acts next. */
export interface BatchLine {
  batch: { id: string; label?: string; kind: BatchKind; state: BatchState; test?: true; purpose?: "outreach"; createdAt: string };
  brand: { id: string; name: string };
  product: { id: string; name: string };
  who: BatchWaitsFor;
  /** What is asked of the owner, or the step the agent is at. */
  text: string;
  /** The dashboard page of the batch. */
  to: string;
  /** The owner answers his agent in chat: the dashboard has no control for it. */
  chat?: true;
}

export const ATTENTION_KINDS = ["replies", "ad_picks", "ads", "follow_ups", "firsts", "change_requests", "taste", "connections"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** A group of things that wait for the owner outside the batches, with the page where he acts. */
export interface AttentionLine {
  kind: AttentionKind;
  count: number;
  /** A dashboard path. */
  to: string;
}

/** What waits for the owner on each part of the dashboard. A member gets the studio's number only, and it is zero. */
export interface AttentionCounts {
  studio: number;
  outreach?: number;
  clients?: number;
  taste?: number;
  connections?: number;
}

/** What the start page and the top bar read: every batch with who acts next, and what else waits for the owner. */
export interface Attention {
  /** Newest first. */
  batches: BatchLine[];
  /** Only the groups with something in them. Empty for a member. */
  lines: AttentionLine[];
  counts: AttentionCounts;
}
