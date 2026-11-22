import type { OutreachAd, OutreachEvent, OutreachEventBody, OutreachSend, Prospect, ProspectFile } from "@a11-wild/shared";
import { type LoadRow, loadRows } from "../../src/outreach/load.js";
import type { OutreachStore } from "../../src/outreach/store.js";

/** A row of a made-up list. No real brand and no real contact is in a test. */
export const row = (n: number, extra: Partial<LoadRow> = {}): LoadRow => ({
  n,
  brand: `Brand ${n}`,
  sector: "F&B",
  liveAds: 24,
  tier: "20+ live ads",
  newestAd: "2026-11-01",
  whatsapp: `+65 8000 ${String(n).padStart(4, "0")}`,
  email: `hello@brand${n}.example`,
  ...extra,
});

export const profile = (n: number, extra: Partial<Prospect> = {}): Prospect => ({
  id: String(n).padStart(5, "0"),
  n,
  brand: `Brand ${n}`,
  sector: "F&B",
  liveAds: 24,
  tier: "20+",
  whatsapp: [`658000${String(n).padStart(4, "0")}`],
  email: `hello@brand${n}.example`,
  loadedAt: "2026-11-23T01:00:00.000Z",
  ...extra,
});

let tick = 0;
/** An event, each one a second after the one before. */
export const event = (body: OutreachEventBody, by: OutreachEvent["by"] = "owner"): OutreachEvent =>
  ({ ...body, id: `e${++tick}`, at: new Date(Date.parse("2026-11-23T02:00:00Z") + tick * 1000).toISOString(), by }) as OutreachEvent;

export const ad = (n: number): OutreachAd => ({ n, batchId: `batch-${n}`, imageId: `image-${n}`, kind: "v2", key: `outreach/x/${n}.png`, why: "The pack on its own colour.", at: new Date(Date.parse("2026-11-23T02:00:00Z") + ++tick * 1000).toISOString() });

export const send = (step: 0 | 1 | 2, day = "2026-11-23"): OutreachSend => ({ step, day, channel: "whatsapp", title: "Brand, I made this for you", text: "Hi", at: `${day}T03:00:00.000Z` });

export const file = (extra: Partial<ProspectFile> = {}, n = 1): ProspectFile => ({ profile: profile(n), ads: [], sends: [], events: [], ...extra });

/** Loads made-up rows into a studio's list and gives the prospects' ids. */
export async function loadProspects(studio: { services: { outreach: { store: OutreachStore } }; clock: { now: Date } }, rows: LoadRow[] = [row(1)]): Promise<string[]> {
  await loadRows(studio.services.outreach.store, rows, () => studio.clock.now);
  return rows.map((entry) => String(entry.n).padStart(5, "0"));
}
