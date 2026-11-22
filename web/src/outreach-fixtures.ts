import type { OutreachAdView, OutreachMessage, ProspectPage, ProspectRow, TodayLine, TodayPage } from "@a11-wild/shared";

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
