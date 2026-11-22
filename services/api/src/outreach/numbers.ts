import { OUTREACH_STAGES, OUTREACH_TIERS, type OutreachCount, type OutreachNumbers, type OutreachStage, type OutreachTier, type ProspectFile, type ProspectRow } from "@a11-wild/shared";
import { channelOf, optedOut, stageOf } from "./stage.js";

const none = (): OutreachCount => ({ all: 0, byTier: { "20+": 0, "5-19": 0, "<5": 0 }, byChannel: { whatsapp: 0, email: 0 } });

/** The numbers of the campaign: sent, replied, said more, opted out and clients, each also by tier and by channel. A test prospect is in none. */
export function numbersOf(files: ProspectFile[], optOuts: ReadonlySet<string>): OutreachNumbers {
  const numbers: OutreachNumbers = { prospects: 0, sent: none(), replied: none(), saidMore: none(), optedOut: none(), clients: none() };
  for (const file of files) {
    if (file.profile.test) continue;
    numbers.prospects += 1;
    // The channel of the first message when one was sent, else the one a message would take.
    const channel = file.sends.find((send) => send.step === 0)?.channel ?? channelOf(file);
    const add = (count: OutreachCount) => {
      count.all += 1;
      count.byTier[file.profile.tier] += 1;
      if (channel) count.byChannel[channel] += 1;
    };
    const replies = file.events.filter((event) => event.type === "reply");
    if (file.sends.some((send) => send.step === 0)) add(numbers.sent);
    if (replies.length > 0) add(numbers.replied);
    if (replies.some((event) => event.type === "reply" && event.reply === "more")) add(numbers.saidMore);
    if (optedOut(file, optOuts)) add(numbers.optedOut);
    else if (stageOf(file, optOuts) === "client") add(numbers.clients);
  }
  return numbers;
}

export interface ProspectFilter {
  q?: string | undefined;
  tier?: OutreachTier | undefined;
  sector?: string | undefined;
  stage?: OutreachStage | undefined;
}

/** Reads the search and the filters of a request. A value that is no tier or no stage is refused, not ignored. */
export function filterOf(query: Record<string, string | undefined>): ProspectFilter | undefined {
  const { q, tier, sector, stage } = query;
  if (tier !== undefined && !OUTREACH_TIERS.includes(tier as OutreachTier)) return undefined;
  if (stage !== undefined && !OUTREACH_STAGES.includes(stage as OutreachStage)) return undefined;
  if ((q?.length ?? 0) > 100 || (sector?.length ?? 0) > 100) return undefined;
  return { q: q?.trim().toLowerCase() || undefined, tier: tier as OutreachTier | undefined, sector: sector || undefined, stage: stage as OutreachStage | undefined };
}

/** The rows a search by name and the filters leave, in list order. A test prospect comes first. */
export function filtered(rows: ProspectRow[], filter: ProspectFilter): ProspectRow[] {
  return rows
    .filter((row) => (!filter.q || row.brand.toLowerCase().includes(filter.q)) && (!filter.tier || row.tier === filter.tier) && (!filter.sector || row.sector === filter.sector) && (!filter.stage || row.stage === filter.stage))
    .sort((a, b) => a.n - b.n);
}
