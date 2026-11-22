import { randomUUID } from "node:crypto";
import { OUTREACH_TIERS, type OutreachTier, type Prospect } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { EMAIL } from "./messages.js";
import { type OutreachStore, prospectId } from "./store.js";

/** One row of the owner's list, as plain text and numbers. The spreadsheet is read outside the server. */
export interface LoadRow {
  n: number;
  brand: string;
  sector: string;
  liveAds: number | string;
  tier: string;
  newestAd?: string | undefined;
  bestRoute?: string | undefined;
  secondRoute?: string | undefined;
  whatsapp?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  instagram?: string | undefined;
  decisionMaker?: string | undefined;
  dmTitle?: string | undefined;
  linkedin?: string | undefined;
}

/** A refused row names its number and its field. It never repeats the value: a contact detail must not come back. */
export interface LoadRefusal {
  row: number;
  field: string;
  why: string;
}

class RowError extends Error {
  constructor(
    readonly field: string,
    readonly why: string,
  ) {
    super(why);
  }
}

const SG = "65";
const LOCAL = /^[3689]\d{7}$/;

// eslint-disable-next-line no-control-regex
const plain = (value: string | undefined): string | undefined => value?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() || undefined;

/** The digits of each number, with the country code. A Singapore number of eight digits gets 65. */
export function numbers(value: string | undefined): string[] {
  const text = plain(value);
  if (!text) return [];
  const found = text
    .split(/[;,/]/)
    // Two local numbers with a space between them are two numbers, not one.
    .flatMap((piece) => (/^\s*\d{8}\s+\d{8}\s*$/.test(piece) ? piece.trim().split(/\s+/) : [piece]))
    .map((piece) => piece.replace(/[\s().-]/g, "").replace(/^\+/, ""))
    .filter((piece) => piece !== "")
    .map((digits) => {
      if (!/^\d+$/.test(digits)) throw new RowError("whatsapp", "the WhatsApp number is not a number");
      const full = LOCAL.test(digits) ? SG + digits : digits;
      if (full.length < 10 || full.length > 15) throw new RowError("whatsapp", "the WhatsApp number does not have the length of a number with its country code");
      return full;
    });
  return [...new Set(found)];
}

export function address(value: string | undefined): string | undefined {
  const text = plain(value)?.toLowerCase();
  if (!text) return undefined;
  if (text.length > 254 || !EMAIL.test(text)) throw new RowError("email", "the address is not an email address");
  return text;
}

function tierOf(value: string): OutreachTier {
  const tier = OUTREACH_TIERS.find((name) => value.trim().startsWith(name));
  if (!tier) throw new RowError("tier", `the spend tier is none of: ${OUTREACH_TIERS.join(", ")}`);
  return tier;
}

function count(value: number | string): number {
  const n = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new RowError("liveAds", "the number of live ads is not a whole number");
  return n;
}

function day(value: string | undefined): string | undefined {
  const text = plain(value);
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new RowError("newestAd", "the day of the newest ad is not a date as YYYY-MM-DD");
  return text;
}

const optional = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> => (value === undefined ? {} : ({ [key]: value } as Record<K, string>));

/** Checks one row and gives its profile. */
export function profileOf(row: LoadRow, loadedAt: string): Prospect {
  if (!Number.isInteger(row.n) || row.n < 1 || row.n > 99999) throw new RowError("n", "the number in the list is not a whole number from 1");
  const brand = plain(row.brand);
  if (!brand) throw new RowError("brand", "the brand has no name");
  return {
    id: prospectId(row.n),
    n: row.n,
    brand,
    sector: plain(row.sector) ?? "Other",
    liveAds: count(row.liveAds),
    tier: tierOf(row.tier),
    ...optional("newestAd", day(row.newestAd)),
    ...optional("bestRoute", plain(row.bestRoute)),
    ...optional("secondRoute", plain(row.secondRoute)),
    whatsapp: numbers(row.whatsapp),
    ...optional("email", address(row.email)),
    ...optional("phone", plain(row.phone)),
    ...optional("instagram", plain(row.instagram)),
    ...optional("decisionMaker", plain(row.decisionMaker)),
    ...optional("dmTitle", plain(row.dmTitle)),
    ...optional("linkedin", plain(row.linkedin)),
    loadedAt,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Loads rows of the list. It can be run again: it adds new rows and updates the list's own fields.
 * It writes profiles, and the opt-out register for a brand that opted out, so no history, ad, opt-out or note is changed or removed.
 */
export async function loadRows(store: OutreachStore, rows: LoadRow[], now: () => Date): Promise<{ added: number; updated: number; refused: LoadRefusal[] }> {
  const files = new Map((await store.all()).map((file) => [file.profile.id, file]));
  const loadedAt = now().toISOString();
  const refused: LoadRefusal[] = [];
  const seen = new Set<number>();
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    try {
      const profile = profileOf(row, loadedAt);
      if (seen.has(profile.n)) throw new RowError("n", "this number is in the rows twice");
      seen.add(profile.n);
      const file = files.get(profile.id);
      const before = file?.profile;
      // A number that now names another brand would give that brand the first one's history.
      if (before && !sameName(before.brand, profile.brand)) throw new RowError("brand", `number ${profile.n} is saved as "${before.brand}": a row keeps its number`);
      await store.saveProfile(profile);
      // An opt-out is for the contact. A number or an address the list now gives to an opted-out brand is off every list too.
      if (file && !profile.test && file.events.some((event) => event.type === "optout")) await store.addOptOut(profile);
      if (before) updated += 1;
      else added += 1;
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      refused.push({ row: row.n, field: error.field, why: error.why });
    }
  }
  return { added, updated, refused };
}

/** A prospect made to try the pages. Its name says what it is. */
export async function makeTestProspect(store: OutreachStore, input: { brand: string; whatsapp?: string | undefined; email?: string | undefined }, now: () => Date): Promise<Prospect> {
  let checked: Prospect;
  try {
    checked = profileOf({ n: 1, brand: input.brand, sector: "Test", liveAds: 0, tier: OUTREACH_TIERS[0], whatsapp: input.whatsapp, email: input.email }, now().toISOString());
  } catch (error) {
    if (error instanceof RowError) throw new Refusal(`The test prospect was not made: ${error.message}.`);
    throw error;
  }
  const profile: Prospect = { ...checked, id: `T${randomUUID().replace(/-/g, "").slice(0, 8)}`, n: 0, test: true };
  await store.saveProfile(profile);
  return profile;
}
