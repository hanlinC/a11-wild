import type { OutreachAd, OutreachChannel, OutreachEvent, OutreachStage, Prospect, ProspectFile } from "@a11-wild/shared";
import { contactKeys } from "./store.js";

/** Two tries at an ad the owner says yes to. After the second no the brand is parked. */
export const AD_TRIES = 2;

type EventOf<T extends OutreachEvent["type"]> = Extract<OutreachEvent, { type: T }>;

const byTime = <T extends { at: string }>(items: T[]): T[] => [...items].sort((a, b) => a.at.localeCompare(b.at));

function last<T extends OutreachEvent["type"]>(events: OutreachEvent[], type: T): EventOf<T> | undefined {
  return byTime(events)
    .filter((event): event is EventOf<T> => event.type === type)
    .at(-1);
}

/** The owner's yes or no to one ad: the newest one counts. The final of the draft he picked has his yes until he says no to it. */
export function verdictOf(file: ProspectFile, ad: OutreachAd): EventOf<"ad_yes"> | EventOf<"ad_no"> | undefined {
  const said = byTime(file.events)
    .filter((event): event is EventOf<"ad_yes"> | EventOf<"ad_no"> => (event.type === "ad_yes" || event.type === "ad_no") && event.ad === ad.n)
    .at(-1);
  return said ?? (ad.picked ? { type: "ad_yes", ad: ad.n, id: `pick-${ad.n}`, at: ad.at, by: "owner" } : undefined);
}

type Choice = EventOf<"pick"> | EventOf<"none"> | EventOf<"words">;

const choices = (file: ProspectFile, batchId?: string): Choice[] =>
  byTime(file.events).filter((event): event is Choice => (event.type === "pick" || event.type === "none" || event.type === "words") && (batchId === undefined || event.batchId === batchId));

/** The ad made of a pick: the ad of the pick's batch that was attached after it and before his next pick in that batch. */
function adOfPick(file: ProspectFile, pick: EventOf<"pick">): OutreachAd | undefined {
  const next = choices(file, pick.batchId).find((event) => event.type === "pick" && event.at > pick.at);
  return [...file.ads].sort((a, b) => a.n - b.n).find((ad) => ad.batchId === pick.batchId && ad.at >= pick.at && (!next || ad.at < next.at));
}

/** The drafts of a batch whose full-size ad the owner refused: he does not pick those again. */
export const refusedDrafts = (file: ProspectFile, batchId: string): Set<string> =>
  new Set(
    choices(file, batchId).flatMap((event) => {
      if (event.type !== "pick") return [];
      const ad = adOfPick(file, event);
      return ad && verdictOf(file, ad)?.type === "ad_no" ? [event.imageId] : [];
    }),
  );

/** True when the owner put his own picture on the page at or after a moment, and his yes on it stands. It answers the drafts in place of a pick. */
const ownPictureSince = (file: ProspectFile, at: string): boolean => file.ads.some((ad) => ad.from === "owner" && ad.at >= at && verdictOf(file, ad)?.type === "ad_yes");

/**
 * The drafts that wait for the owner's pick: the newest ones shown, with no answer of his after them.
 * A pick whose final he then refused is no answer any more: he chooses among the drafts again.
 */
export function candidatesWait(file: ProspectFile): EventOf<"candidates"> | undefined {
  const shown = last(file.events, "candidates");
  if (!shown) return undefined;
  const answer = choices(file, shown.batchId).filter((event) => event.at >= shown.at).at(-1);
  if (ownPictureSince(file, (answer ?? shown).at)) return undefined;
  if (!answer) return shown;
  if (answer.type !== "pick") return undefined;
  const ad = adOfPick(file, answer);
  return ad && verdictOf(file, ad)?.type === "ad_no" ? shown : undefined;
}

/**
 * What the agent owes the owner after his choice: the final of the draft he picked, or the drafts again with the words he asked for.
 * A pick is owed until an ad of its batch is attached after it; other words are owed until the drafts are shown again.
 * This reads the timeline only. `owedNow` is the one to ask before any work: it knows a brand that takes no ad.
 */
export function owedByAgent(file: ProspectFile): EventOf<"pick"> | EventOf<"words"> | undefined {
  const choice = choices(file).at(-1);
  if (!choice || choice.type === "none") return undefined;
  // His own picture after his choice wins: the agent makes nothing more for that choice.
  if (ownPictureSince(file, choice.at)) return undefined;
  if (choice.type === "pick") return adOfPick(file, choice) ? undefined : choice;
  return file.events.some((event) => event.type === "candidates" && event.batchId === choice.batchId && event.at >= choice.at) ? undefined : choice;
}

/**
 * Each no of the owner that uses up a try, oldest first: a no to an ad the agent chose, or to all the drafts of a batch.
 * A no to the final of his own pick uses none: he goes back to the drafts.
 */
export const refusals = (file: ProspectFile): (EventOf<"ad_no"> | EventOf<"none">)[] =>
  byTime(file.events).filter((event): event is EventOf<"ad_no"> | EventOf<"none"> => event.type === "none" || (event.type === "ad_no" && !file.ads.find((ad) => ad.n === event.ad)?.picked));

export const newestAd = (file: ProspectFile): OutreachAd | undefined => [...file.ads].sort((a, b) => a.n - b.n).at(-1);

/** The newest ad the owner said yes to: the one a message carries. */
export const approvedAd = (file: ProspectFile): OutreachAd | undefined =>
  [...file.ads]
    .sort((a, b) => b.n - a.n)
    .find((ad) => verdictOf(file, ad)?.type === "ad_yes");

/** True when the newest ad has no yes and no no yet. */
export function adWaits(file: ProspectFile): boolean {
  const ad = newestAd(file);
  return ad !== undefined && verdictOf(file, ad) === undefined;
}

/** The "more" reply that has no answer of the owner after it. */
export function owedAnswer(file: ProspectFile): EventOf<"reply"> | undefined {
  const reply = last(file.events, "reply");
  if (reply?.reply !== "more") return undefined;
  const answered = last(file.events, "answered");
  return answered && answered.at >= reply.at ? undefined : reply;
}

const hasRoute = (profile: Prospect): boolean => profile.whatsapp.length > 0 || profile.email !== undefined;

/** WhatsApp when the brand has a number, else its verified address. The owner can choose the other for one brand. */
export function channelOf(file: ProspectFile): OutreachChannel | undefined {
  const { profile } = file;
  const chosen = last(file.events, "channel")?.channel;
  if (chosen === "whatsapp" && profile.whatsapp.length > 0) return chosen;
  if (chosen === "email" && profile.email) return chosen;
  return profile.whatsapp.length > 0 ? "whatsapp" : profile.email ? "email" : undefined;
}

export function optedOut(file: ProspectFile, optOuts: ReadonlySet<string>): boolean {
  if (file.events.some((event) => event.type === "optout")) return true;
  // A test prospect's opt-out never enters the register, and the register never reaches a test prospect.
  return !file.profile.test && contactKeys(file.profile).some((key) => optOuts.has(key));
}

/**
 * The stage is not stored: it comes from the profile, the ads, the sends and the events, so it can be explained from the timeline alone.
 * An ad attached after the first message does not change it; `adWaits` says that a new ad waits for the owner's look.
 */
export function stageOf(file: ProspectFile, optOuts: ReadonlySet<string>): OutreachStage {
  if (optedOut(file, optOuts)) return "opted_out";
  const set = last(file.events, "stage");
  if (set && set.stage !== "auto") return set.stage;
  if (file.events.some((event) => event.type === "reply")) return "replied";
  if (file.sends.some((send) => send.step === 0)) return "contacted";
  const ad = newestAd(file);
  // The studio makes no ad for a service. The owner's own picture is one, so the brand then goes on like any other.
  if (last(file.events, "kind")?.kind === "service" && ad?.from !== "owner") return "needs_service_ad";
  if (!hasRoute(file.profile)) return "no_route";
  const verdict = ad && verdictOf(file, ad);
  // His own picture is ready to send whatever the drafts wait for.
  if (ad?.from === "owner" && verdict?.type === "ad_yes") return "ready";
  if (owedByAgent(file)) return "pick_made";
  if (ad && !verdict) return "ad_waits";
  if (candidatesWait(file)) return "pick_waits";
  if (verdict?.type === "ad_yes") return "ready";
  if (refusals(file).length >= AD_TRIES) return "parked";
  return "new";
}

/** The stages at which a brand takes no ad: nothing is chosen for it and nothing is made. */
export const TAKES_NO_AD: readonly OutreachStage[] = ["opted_out", "lost", "parked", "no_route", "needs_service_ad"];

/** What the agent owes the owner now. Nothing for a brand that takes no ad: he parked it, lost it, or it opted out after his choice. */
export const owedNow = (file: ProspectFile, optOuts: ReadonlySet<string>): EventOf<"pick"> | EventOf<"words"> | undefined => (TAKES_NO_AD.includes(stageOf(file, optOuts)) ? undefined : owedByAgent(file));

/**
 * Why the agent should make an ad for this prospect now, or nothing when it should not:
 * a "more" reply with no ad after it, or a brand with no ad yet, or one ad the owner said no to.
 */
export function wantsAd(file: ProspectFile, optOuts: ReadonlySet<string>): { why: "more" | "first" | "again"; ownerSaid?: string } | undefined {
  const stage = stageOf(file, optOuts);
  if (adWaits(file) || candidatesWait(file) || owedByAgent(file)) return undefined;
  const more = byTime(file.events)
    .filter((event): event is EventOf<"reply"> => event.type === "reply" && event.reply === "more")
    .at(-1);
  if (more && (stage === "replied" || stage === "in_talks")) {
    // One more ad for each "more", and a second try when the owner said no to it.
    const since = file.ads.filter((ad) => ad.at > more.at);
    const refused = since.filter((ad) => verdictOf(file, ad)?.type === "ad_no");
    const tries = refusals(file).filter((no) => no.at > more.at);
    if (since.length - refused.length > 0 || tries.length >= AD_TRIES) return undefined;
    const no = tries.at(-1);
    return { why: "more", ...(no ? { ownerSaid: no.ownerSaid } : {}) };
  }
  if (stage !== "new") return undefined;
  const no = refusals(file).at(-1);
  return no ? { why: "again", ownerSaid: no.ownerSaid } : { why: "first" };
}

/** What the brand sells, when someone has said so. */
export const kindOf = (file: ProspectFile): "product" | "service" | undefined => last(file.events, "kind")?.kind;
