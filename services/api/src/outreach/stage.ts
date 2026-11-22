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

/** The owner's yes or no to one ad: the newest one counts. */
export function verdictOf(file: ProspectFile, ad: OutreachAd): EventOf<"ad_yes"> | EventOf<"ad_no"> | undefined {
  return byTime(file.events)
    .filter((event): event is EventOf<"ad_yes"> | EventOf<"ad_no"> => (event.type === "ad_yes" || event.type === "ad_no") && event.ad === ad.n)
    .at(-1);
}

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
  if (ad && !verdict) return "ad_waits";
  if (verdict?.type === "ad_yes") return "ready";
  if (file.events.filter((event) => event.type === "ad_no").length >= AD_TRIES) return "parked";
  return "new";
}

/**
 * Why the agent should make an ad for this prospect now, or nothing when it should not:
 * a "more" reply with no ad after it, or a brand with no ad yet, or one ad the owner said no to.
 */
export function wantsAd(file: ProspectFile, optOuts: ReadonlySet<string>): { why: "more" | "first" | "again"; ownerSaid?: string } | undefined {
  const stage = stageOf(file, optOuts);
  if (adWaits(file)) return undefined;
  const more = byTime(file.events)
    .filter((event): event is EventOf<"reply"> => event.type === "reply" && event.reply === "more")
    .at(-1);
  if (more && (stage === "replied" || stage === "in_talks")) {
    // One more ad for each "more", and a second try when the owner said no to it.
    const since = file.ads.filter((ad) => ad.at > more.at);
    const refused = since.filter((ad) => verdictOf(file, ad)?.type === "ad_no");
    if (since.length - refused.length > 0 || refused.length >= AD_TRIES) return undefined;
    const no = refused.at(-1) && verdictOf(file, refused.at(-1)!);
    return { why: "more", ...(no?.type === "ad_no" ? { ownerSaid: no.ownerSaid } : {}) };
  }
  if (stage !== "new") return undefined;
  const no = last(file.events, "ad_no");
  return no ? { why: "again", ownerSaid: no.ownerSaid } : { why: "first" };
}

/** What the brand sells, when someone has said so. */
export const kindOf = (file: ProspectFile): "product" | "service" | undefined => last(file.events, "kind")?.kind;
