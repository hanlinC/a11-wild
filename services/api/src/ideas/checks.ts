import type { Fact, FunnelStage, Idea, Insight } from "@a11-wild/shared";
import { FUNNEL_STAGES } from "@a11-wild/shared";

export const IDEAS_PER_BATCH = 3;
export const ELEMENTS_MAX = 5;
/** A kind with words writes many ideas, and a blind critic chooses one for each funnel stage. */
export const BURST_MIN = 24;
export const BURST_MAX = 30;
export const PER_STAGE_MIN = 8;
export const HEADLINE_WORDS_MAX = 8;
export const SUBLINE_WORDS_MAX = 8;
export const WORDS_MAX = 14;
export const CONCEPTS_MIN = 6;
export const CONCEPTS_MAX = 15;
export const TERRITORIES_MIN = 3;
export const TERRITORIES_MAX = 5;
export const INSIGHTS_MIN = 3;

export type IdeaInput = Omit<Idea, "id">;

export const STAGE_NAMES: Record<FunnelStage, string> = { tof: "top of funnel", mof: "middle of funnel", bof: "bottom of funnel" };

/** Words with a letter or a digit in them: "S$58.90." is one word, a lone dash is none. */
export const wordCount = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * A price, a saving or a delivery offer, as the words of an ad write them. A percentage alone is not one ("100% oat").
 * Found by review, 22-11-2026: "Next-day delivery" and "Save 20%" passed the first, narrower pattern.
 */
const OFFER = new RegExp(
  [
    String.raw`(?:S\$|SGD|\$)\s?\d`,
    String.raw`\d\s?%\s?(?:off|discount|less|cheaper)\b`,
    String.raw`\bsave\s+(?:up\s+to\s+)?(?:S\$|SGD|\$)?\s?\d`,
    String.raw`\b(?:discounts?|promo(?:tion)?s?|vouchers?|coupons?)\b`,
    String.raw`\b(?:1|one)[- ]for[- ](?:1|one)\b|\bbuy\s+\w+\s*,?\s+(?:get|free)\b`,
    String.raw`\b(?:delivery|delivered|shipping)\b`,
  ].join("|"),
  "i",
);
/** True when the words name a price, a saving or a delivery offer. */
export const namesOffer = (text: string): boolean => OFFER.test(text);
/** A number as written: "58.90", "1,000", "10". */
const NUMBER = /\d+(?:[.,]\d+)*/g;
const plain = (text: string) => text.replace(/(\d),(?=\d{3})/g, "$1");

/** The numbers in the words that no named fact holds. A number a fact does not prove is not printed. */
export function unprovenNumbers(words: string, facts: Pick<Fact, "claim" | "quote">[]): string[] {
  const proof = new Set(facts.flatMap((fact) => plain(`${fact.claim} ${fact.quote}`).match(NUMBER) ?? []));
  return [...new Set(plain(words).match(NUMBER) ?? [])].filter((number) => !proof.has(number));
}

export interface Words {
  headline: string;
  subline: string;
  footnote?: string;
  stage?: FunnelStage;
}

/**
 * The countable facts of the words of one ad: their length, an offer on a top-of-funnel ad, a number
 * that no fact holds. `length` faults are a guide the owner's own words stand over; the others are not.
 */
export function wordFaults(words: Words, facts: Pick<Fact, "claim" | "quote">[]): { length: string[]; truth: string[] } {
  const length: string[] = [];
  const truth: string[] = [];
  const headline = wordCount(words.headline);
  const subline = wordCount(words.subline);
  if (headline > HEADLINE_WORDS_MAX) length.push(`the headline has ${headline} words, and the most is ${HEADLINE_WORDS_MAX}`);
  if (subline > SUBLINE_WORDS_MAX) length.push(`the subline has ${subline} words, and the most is ${SUBLINE_WORDS_MAX}`);
  if (headline <= HEADLINE_WORDS_MAX && subline <= SUBLINE_WORDS_MAX && headline + subline > WORDS_MAX) {
    length.push(`the headline and the subline have ${headline + subline} words together, and the most is ${WORDS_MAX}`);
  }
  const all = [words.headline, words.subline, words.footnote ?? ""].join(" ");
  if (words.stage === "tof" && OFFER.test(all)) truth.push("a top-of-funnel ad names no price, saving or delivery offer");
  const unproven = unprovenNumbers(all, facts);
  if (unproven.length > 0) truth.push(`no fact named in claims holds the number ${unproven.join(", ")}`);
  return { length, truth };
}

function sharedFaults(name: string, idea: IdeaInput): string[] {
  const faults: string[] = [];
  if (idea.elements.length > ELEMENTS_MAX) faults.push(`${name} has ${idea.elements.length} elements. The most is ${ELEMENTS_MAX}: cut until one thing is left to look at.`);
  if (idea.elements.length === 0) faults.push(`${name} names no element.`);
  if (!idea.killTest.passed) faults.push(`${name} fails its kill test (${idea.killTest.note}). It is cut: write another idea in its place.`);
  return faults;
}

/**
 * The countable facts of an idea burst. Each answer is true or false: how many ideas, how many
 * elements, whether a reference and both tests are there. Taste is not checked here; it stays with
 * the agent, the critic and the owner.
 */
export function ideaFaults(ideas: IdeaInput[]): string[] {
  const faults: string[] = [];
  if (ideas.length !== IDEAS_PER_BATCH) faults.push(`A batch holds ${IDEAS_PER_BATCH} ideas. This call has ${ideas.length}.`);
  for (const [index, idea] of ideas.entries()) {
    const name = `Idea ${index + 1} ("${idea.title}")`;
    faults.push(...sharedFaults(name, idea));
    if (idea.references.length === 0) faults.push(`${name} has no reference from outside the product's category. Give at least one, with one line on what it does.`);
  }
  return faults;
}

/** The countable facts of one idea with words: its elements, its words against the facts it names, and its real photos. */
function wordedFaults(name: string, idea: IdeaInput, byId: Map<string, Fact>, photoNames: string[]): string[] {
  const faults = sharedFaults(name, idea);
  if (!idea.stage || !idea.headline || !idea.subline) return [...faults, `${name} needs a stage, a headline and a subline.`];
  const unknown = (idea.claims ?? []).filter((claim) => !byId.has(claim.factId)).map((claim) => claim.factId);
  if (unknown.length > 0) faults.push(`${name} names a fact that is not saved for this product: ${unknown.join(", ")}. facts_list gives the facts.`);
  const proof = (idea.claims ?? []).flatMap((claim) => byId.get(claim.factId) ?? []);
  const { length, truth } = wordFaults({ headline: idea.headline, subline: idea.subline, stage: idea.stage, ...(idea.footnote ? { footnote: idea.footnote } : {}) }, proof);
  for (const fault of [...length, ...truth]) faults.push(`${name}: ${fault}.`);
  if (!idea.shows || idea.shows.length === 0) faults.push(`${name} names no real photo in shows. Name the photo of each brand item and prop the picture shows.`);
  const missing = (idea.shows ?? []).filter((photo) => !photoNames.includes(photo));
  if (missing.length > 0) faults.push(`${name} shows ${missing.join(", ")}, and this product has no such photo. Its photos: ${photoNames.join(", ") || "none"}.`);
  return faults;
}

/** The countable facts of a burst of ideas with words: its size, its spread over the funnel, and each idea's words. */
export function burstFaults(ideas: IdeaInput[], facts: Fact[], photoNames: string[]): string[] {
  const faults: string[] = [];
  if (ideas.length < BURST_MIN || ideas.length > BURST_MAX) faults.push(`A burst holds ${BURST_MIN} to ${BURST_MAX} ideas. This call has ${ideas.length}.`);
  for (const stage of FUNNEL_STAGES) {
    const count = ideas.filter((idea) => idea.stage === stage).length;
    if (count < PER_STAGE_MIN) faults.push(`The burst has ${count} ideas for ${STAGE_NAMES[stage]}. Each stage needs ${PER_STAGE_MIN} or more.`);
  }
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  for (const [index, idea] of ideas.entries()) faults.push(...wordedFaults(`Idea ${index + 1} ("${idea.title}")`, idea, byId, photoNames));
  return faults;
}

/** The names of a product's real photos, as an idea and a render call them: "pack-1", "food-2". */
export function photoNames(photos: { kind: string }[]): string[] {
  const seen = new Map<string, number>();
  return photos.map((photo) => {
    const number = (seen.get(photo.kind) ?? 0) + 1;
    seen.set(photo.kind, number);
    return `${photo.kind}-${number}`;
  });
}

/**
 * The countable facts of a set of concepts: its size, its territories, the insight each one stands
 * on, and each concept's words and real photos. Whether a concept is good is not checked here.
 */
export function conceptFaults(ideas: IdeaInput[], insights: Pick<Insight, "id">[], facts: Fact[], photoNames: string[], most = CONCEPTS_MAX): string[] {
  const faults: string[] = [];
  if (ideas.length < CONCEPTS_MIN || ideas.length > most) faults.push(`A set holds ${CONCEPTS_MIN} to ${most} concepts. This one has ${ideas.length}.`);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const known = new Set(insights.map((insight) => insight.id));
  /** The insights of each territory, by its name without case or outer space. */
  const territories = new Map<string, Set<string>>();
  for (const [index, idea] of ideas.entries()) {
    const name = `Concept ${index + 1} ("${idea.title}")`;
    faults.push(...wordedFaults(name, idea, byId, photoNames));
    const part = idea.concept;
    if (!part) {
      faults.push(`${name} has no concept part.`);
      continue;
    }
    if (!known.has(part.insightId)) faults.push(`${name} stands on insight ${part.insightId}, and the brief has no such insight. brief_get gives the insights.`);
    const territory = part.territory.trim().toLowerCase();
    territories.set(territory, (territories.get(territory) ?? new Set()).add(part.insightId));
    const basis = part.sublineBasis;
    if (basis.kind === "fact" && !(basis.factId && idea.claims?.some((claim) => claim.factId === basis.factId))) {
      faults.push(`${name}: its subline is a fact, so sublineBasis names that fact, and claims holds it too.`);
    }
  }
  // A round of more concepts may open a new territory, so the most holds for the first set only.
  if (territories.size < TERRITORIES_MIN || (most === CONCEPTS_MAX && territories.size > TERRITORIES_MAX)) {
    faults.push(`A set has ${TERRITORIES_MIN} to ${TERRITORIES_MAX} territories. This one has ${territories.size}.`);
  }
  const owner = new Map<string, string>();
  for (const [territory, used] of territories) {
    if (used.size > 1) faults.push(`The territory "${territory}" stands on ${used.size} insights. A territory stands on one.`);
    for (const insightId of used) {
      const first = owner.get(insightId);
      if (first && first !== territory) faults.push(`The territories "${first}" and "${territory}" stand on the same insight ${insightId}. They are one territory.`);
      else owner.set(insightId, territory);
    }
  }
  return faults;
}
