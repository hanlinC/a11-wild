import type { OutreachAd, OutreachAdView, OutreachStep, OutreachTemplates, ProspectFile, ProspectRow, TodayLine, TodayPage } from "@a11-wild/shared";
import { isSendingDay, nextSendingDay, singaporeDay } from "./days.js";
import { messagesFor } from "./messages.js";
import { chosen, nextStep, sameContact, type OutreachSequence } from "./sequence.js";
import { adWaits, approvedAd, channelOf, newestAd, owedAnswer, stageOf, verdictOf } from "./stage.js";
import type { OutreachStore } from "./store.js";
import type { Pictures } from "../pictures/store.js";

/** A prospect as a line of a list: no number and no address. */
export function rowOf(file: ProspectFile, optOuts: ReadonlySet<string>, shared: ReadonlyMap<string, ProspectFile>): ProspectRow {
  const { profile } = file;
  const stage = stageOf(file, optOuts);
  const channel = channelOf(file);
  const next = stage === "contacted" ? nextStep(file) : undefined;
  const earlier = shared.get(profile.id);
  return {
    id: profile.id,
    n: profile.n,
    brand: profile.brand,
    sector: profile.sector,
    liveAds: profile.liveAds,
    tier: profile.tier,
    stage,
    ...(channel ? { channel } : {}),
    adWaits: adWaits(file) && stage !== "opted_out",
    ...(next ? { next } : {}),
    ...(earlier && !chosen(file) ? { sameContactAs: earlier.profile.brand } : {}),
    ...(profile.test ? { test: true as const } : {}),
  };
}

/** The two links of a picture: one to look at, one to save as a file. */
export type AdLinks = Pick<Pictures, "viewUrl" | "downloadUrl">;

export async function adView(file: ProspectFile, ad: OutreachAd, pictures: AdLinks): Promise<OutreachAdView> {
  const verdict = verdictOf(file, ad)?.type;
  const name = `${file.profile.brand}-ad-${ad.n}.${ad.key.split(".").at(-1) ?? "png"}`;
  const [viewUrl, downloadUrl] = await Promise.all([pictures.viewUrl(ad.key), pictures.downloadUrl(ad.key, name)]);
  return { ...ad, viewUrl, downloadUrl, ...(verdict ? { verdict: verdict === "ad_yes" ? ("yes" as const) : ("no" as const) } : {}) };
}

/** The prospects that wait for the owner today, before any picture link is made for them. */
export interface TodayLists {
  day: string;
  daily: number;
  firstsSent: number;
  templates: OutreachTemplates | undefined;
  optOuts: ReadonlySet<string>;
  shared: ReadonlyMap<string, ProspectFile>;
  /** The answer that has waited longest is first. */
  owed: { file: ProspectFile; reply: { text?: string; at: string } }[];
  followUps: { file: ProspectFile; step: OutreachStep }[];
  firsts: ProspectFile[];
  adsWaiting: ProspectFile[];
}

/**
 * Which prospects wait for the owner today. The Today page and the count on the start page both read this, so they cannot disagree.
 * The weekdays are the plan, and a follow-up is due on one. The lists are the same on every day: the owner sends when he chooses.
 */
export async function todayLists(deps: { store: OutreachStore; sequence: OutreachSequence; now: () => Date }): Promise<TodayLists> {
  const { store, sequence } = deps;
  const day = singaporeDay(deps.now());
  const [files, optOuts, daily, firstsSent, templates] = await Promise.all([store.all(), store.optOuts(), sequence.daily(), store.placesTaken(day), sequence.templates()]);
  const shared = sameContact(files);
  const lists: TodayLists = { day, daily, firstsSent, templates, optOuts, shared, owed: [], followUps: [], firsts: [], adsWaiting: [] };
  let places = Math.max(0, daily - firstsSent);

  for (const file of files) {
    const stage = stageOf(file, optOuts);
    if (stage === "opted_out") continue;
    const reply = owedAnswer(file);
    if (reply && (stage === "replied" || stage === "in_talks")) lists.owed.push({ file, reply: { ...(reply.text ? { text: reply.text } : {}), at: reply.at } });
    if (adWaits(file) && stage !== "lost" && stage !== "parked") lists.adsWaiting.push(file);
    if (stage === "contacted") {
      const next = nextStep(file);
      if (next && next.due <= day) lists.followUps.push({ file, step: next.step });
    }
    if (stage === "ready") {
      // A test prospect takes no place of the day. A brand that shares its contact waits for the owner's choice.
      if (shared.has(file.profile.id) && !chosen(file)) continue;
      if (file.profile.test) lists.firsts.push(file);
      else if (places > 0) {
        places -= 1;
        lists.firsts.push(file);
      }
    }
  }
  lists.owed.sort((a, b) => a.reply.at.localeCompare(b.reply.at));
  return lists;
}

/** What the owner does today, in his order: answers that are owed, follow-ups that are due, new first messages, and ads that wait for his look. */
export async function todayPage(deps: { store: OutreachStore; sequence: OutreachSequence; pictures: AdLinks; now: () => Date }): Promise<TodayPage> {
  const { pictures } = deps;
  const { day, daily, firstsSent, templates, optOuts, shared, owed, followUps, firsts, adsWaiting } = await todayLists(deps);

  const line = async (file: ProspectFile, step: OutreachStep | undefined, ad: OutreachAd | undefined, extra: Partial<TodayLine> = {}): Promise<TodayLine> => ({
    prospect: rowOf(file, optOuts, shared),
    ...(ad ? { ad: await adView(file, ad, pictures) } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(step !== undefined && templates ? { messages: messagesFor(templates.steps[step], file.profile, channelOf(file)) } : {}),
    ...extra,
  });

  const [owedLines, followUpLines, firstLines, waitingLines] = await Promise.all([
    Promise.all(owed.map(({ file, reply }) => line(file, undefined, approvedAd(file), { reply }))),
    Promise.all(followUps.map(({ file, step }) => line(file, step, approvedAd(file)))),
    Promise.all(firsts.map((file) => line(file, 0, approvedAd(file)))),
    Promise.all(adsWaiting.map((file) => line(file, undefined, newestAd(file)))),
  ]);
  return {
    day,
    sendingDay: isSendingDay(day),
    nextSendingDay: nextSendingDay(day),
    daily,
    firstsSent,
    templates: templates !== undefined,
    owed: owedLines,
    followUps: followUpLines,
    firsts: firstLines,
    adsWaiting: waitingLines,
  };
}
