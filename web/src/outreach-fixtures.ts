import type { OutreachAdView, OutreachCandidate, OutreachCandidates, OutreachMessage, ProspectPage, ProspectRow, TodayLine, TodayPage } from "@a11-wild/shared";

/** Made-up outreach data for the page tests. No real brand and no real contact. */
export const prospectRow = (overrides: Partial<ProspectRow> = {}): ProspectRow => ({ id: "00001", n: 1, brand: "Koi Tea", sector: "F&B", liveAds: 24, tier: "20+", stage: "ready", channel: "whatsapp", adWaits: false, ...overrides });

export const adView = (overrides: Partial<OutreachAdView> = {}): OutreachAdView => ({
  n: 1,
  batchId: "b1",
  imageId: "i1",
  kind: "v1",
  key: "outreach/x/1.png",
  why: "The cup on its own colour.",
  at: "2026-11-23T01:00:00.000Z",
  viewUrl: "https://pictures.example/1.png?signed=1",
  downloadUrl: "https://pictures.example/1.png?download=1",
  ...overrides,
});

export const messages = (brand = "Koi Tea"): [OutreachMessage, OutreachMessage] => [
  { title: `New ad for ${brand}`, text: `Hi, I made this ad for ${brand}.`, href: "https://wa.me/6580000001?text=one" },
  { title: `${brand}, I made this for you`, text: `Hi, I made this ad for ${brand}.`, href: "https://wa.me/6580000001?text=two" },
];

export const firstLine = (overrides: Partial<TodayLine> = {}): TodayLine => ({ prospect: prospectRow(), ad: adView({ verdict: "yes" }), step: 0, messages: messages(), ...overrides });

export const todayPage = (overrides: Partial<TodayPage> = {}): TodayPage => ({
  day: "2026-11-23",
  sendingDay: true,
  nextSendingDay: "2026-11-24",
  daily: 5,
  firstsSent: 3,
  templates: true,
  owed: [],
  followUps: [],
  firsts: [],
  adsWaiting: [],
  picks: [],
  ...overrides,
});

export const prospectPage = (overrides: Partial<ProspectPage> = {}): ProspectPage => ({
  prospect: prospectRow(),
  contact: { whatsapp: [{ number: "6580000001", href: "https://wa.me/6580000001" }], email: { address: "hello@koitea.example", href: "mailto:hello@koitea.example" } },
  ads: [adView({ verdict: "yes" })],
  sends: [],
  events: [],
  day: "2026-11-23",
  ...overrides,
});

const draftOf = (ideaId: string, number: number, words: { headline: string; subline: string }, overrides: Partial<OutreachCandidate> = {}): OutreachCandidate => ({
  ideaId,
  title: `Idea ${ideaId}`,
  ...words,
  number,
  imageId: `${ideaId}-draft-${number}`,
  viewUrl: `https://pictures.example/${ideaId}-${number}.jpg`,
  ...overrides,
});

/** Two ideas with two drafts each; the second draft of the second idea has no words yet, and the agent saw a fault in the one before it. */
export const candidates = (overrides: Partial<OutreachCandidates> = {}): OutreachCandidates => {
  const crumbles = { headline: "One fork tap and it crumbles.", subline: "Baked this morning in Katong." };
  const gift = { headline: "Your visiting gift, baked fresh.", subline: "Twelve tarts in a box." };
  return {
    batchId: "batch-1",
    words: true,
    waits: true,
    agentOwes: false,
    choosing: "open",
    drafts: [draftOf("idea-1", 1, crumbles), draftOf("idea-1", 2, crumbles), draftOf("idea-2", 1, gift, { warning: "The pack is drawn 5% wider than in its photo. The limit is 2%. The agent saw: The box is too tall.", findings: ["The pack is drawn 5% wider than in its photo. The limit is 2%.", "The agent saw: The box is too tall."] }), draftOf("idea-2", 2, gift, { blocked: "Its words are not set yet." })],
    ...overrides,
  };
};

