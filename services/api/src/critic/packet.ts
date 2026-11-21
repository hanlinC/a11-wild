import type { Board, BrandKit, CheckItem, Fact, Idea, Product, TruthSheet } from "@a11-wild/shared";
import { seenOf } from "../board/service.js";
import type { CriticStep } from "./store.js";

/** An idea as a blind critic reads it: what the picture is, without its author's own verdict on it. */
export function blindIdea({ id, title, visual, device, focalPoint, elements, references, stage, headline, subline, claims, footnote }: Idea) {
  return {
    id, title, visual, device, focalPoint, elements, references,
    ...(stage ? { stage } : {}),
    ...(headline ? { headline } : {}),
    ...(subline ? { subline } : {}),
    ...(claims ? { claims } : {}),
    ...(footnote ? { footnote } : {}),
  };
}

const READ_FIRST =
  'Before you judge: rules_get with role "critic" and the kind of this batch, then canon_get, taste_log and swipe_search. Judge from this packet and those reads only. Do not call batch_get or board_show: they hold the author\'s own notes.';

interface Common {
  brand: BrandKit;
  product: Product;
  truthSheet: TruthSheet | null;
  facts: Fact[];
}

function about({ brand, product, truthSheet, facts }: Common) {
  return {
    brand: { name: brand.name, url: brand.url, ...(brand.voice ? { voice: brand.voice } : {}), ...(brand.neverSay ? { neverSay: brand.neverSay } : {}) },
    product: { name: product.name, url: product.url },
    truthSheet,
    facts: facts.map(({ claim, quote, url }) => ({ claim, quote, url })),
  };
}

/** What a critic gets to judge a batch's ideas. */
export function ideasPacket(common: Common, ideas: Idea[]) {
  return {
    step: "ideas" satisfies CriticStep,
    readFirst: READ_FIRST,
    ...about(common),
    ideas: ideas.map(blindIdea),
    task: "For each idea say keep or cut, with a reason. Cut an idea that fails the cover test or the kill test of the house rules, or that the owner's taste would pass on. Send all of them in one critic_pick call with the ticket. The ticket works once.",
  };
}

/** What a critic gets to choose one idea for each funnel stage from a burst. The order is not the author's. */
export function burstPacket(common: Common, ideas: Idea[]) {
  return {
    step: "ideas" satisfies CriticStep,
    readFirst: `${READ_FIRST} Also read references_get with this batch's kind: the owner's own proud ads are the bar.`,
    ...about(common),
    ideas: ideas.map(blindIdea),
    task: "Choose one idea for each funnel stage: tof, mof and bof. The bar is an ad the owner would pay for out of his own pocket and be proud of, beside his reference ads: one picture device that the product's truth calls for, and a line that points at it. Check each claim against the facts. If no idea of a stage reaches the bar, refuse that stage (ideaId null) and say what is missing; do not lower the bar. Send the three stages in one critic_select call with the ticket.",
  };
}

/** A draft as a critic sees it: the picture that counts, and what a pixel tool measured in it. */
export interface BlindDraft {
  imageId: string;
  /** The picture viewUrl opens: the draft or its newest repair, and in an ad with words that picture with the approved words and the logo set on it. A rank is of this picture only. */
  shownId: string;
  viewUrl: string;
  measured: CheckItem[];
}

/** The drafts of the ideas the owner has not chosen for yet. An idea he has chosen for is left out, with every trace of his choice. */
export function rankable(board: Board, draftsPerIdea: number): { idea: ReturnType<typeof blindIdea>; drafts: BlindDraft[] }[] {
  return board.ideas
    .filter((entry) => entry.pick === null && entry.drafts.length === draftsPerIdea)
    .map((entry) => ({
      idea: blindIdea(entry.idea),
      drafts: entry.drafts.map((draft) => ({ imageId: draft.image.id, shownId: seenOf(draft).id, viewUrl: draft.words?.viewUrl ?? draft.viewUrl, measured: (draft.checks?.items ?? []).filter((item) => item.tool !== undefined) })),
    }));
}

/** What a critic gets to rank the drafts. */
export function draftsPacket(common: Common, ideas: ReturnType<typeof rankable>) {
  return {
    step: "drafts" satisfies CriticStep,
    readFirst: READ_FIRST,
    ...about(common),
    ideas,
    task: "Open each viewUrl and look at the picture. For each idea, put its drafts in order, best first, with a reason for each place: which one would the owner pick, and why. Send every idea in one critic_rank call with the ticket. The ticket works once. Your rank is kept from the owner and from the main agent until the owner has picked.",
  };
}
