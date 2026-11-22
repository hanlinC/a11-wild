import { randomUUID } from "node:crypto";
import type { OutreachAd, OutreachEvent, OutreachEventBody, OutreachSend, OutreachStep, Prospect, ProspectFile } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

/**
 * Every outreach item sits in one partition, in order by prospect: the profile, then its ads, then its events, then its sends.
 * One read gives the whole list with each history. Nothing but the load rewrites a profile, and a history is only added to,
 * so two writers at once cannot lose each other's change.
 */
const PK = "OUTREACH";
const OPT_OUTS = "OUTREACH#OPTOUT";
const DAYS = "OUTREACH#DAY";
const SETTINGS = "OUTREACH#SET";

const profileKey = (id: string) => `P#${id}`;
const adKey = (id: string, n: number) => `P#${id}#AD#${String(n).padStart(2, "0")}`;
const eventKey = (id: string, at: string, eventId: string) => `P#${id}#E#${at}#${eventId}`;
const sendKey = (id: string, step: OutreachStep) => `P#${id}#S#${step}`;
const uploadKey = (id: string, uploadId: string) => `P#${id}#U#${uploadId}`;
/** Longer than any one call can run. */
const UPLOAD_HOLD_MS = 60_000;

/** The id of a list row: its number, padded so that the table's order is the list's order. */
export const prospectId = (n: number): string => String(n).padStart(5, "0");

/** The key of a contact in the opt-out register: the digits of a number, or an address in lower case. */
export const contactKeys = (profile: Pick<Prospect, "whatsapp" | "email">): string[] => [...profile.whatsapp.map((number) => `W#${number}`), ...(profile.email ? [`E#${profile.email}`] : [])];

/** One ad at most for each "more" reply, and two tries at a first ad: the store keeps no more than this for a prospect. */
const ADS_MAX = 20;

export class OutreachStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Every prospect with its history, in list order. Test prospects come last. */
  async all(): Promise<ProspectFile[]> {
    const files = new Map<string, ProspectFile>();
    // The profile's key sorts before the keys of its ads, events and sends.
    for (const item of await this.table.query<Item>(PK)) {
      const [, id, part] = item.sk.split("#");
      if (!id) continue;
      if (part === undefined) {
        files.set(id, { profile: record<Prospect>(item as Item & Prospect), ads: [], sends: [], events: [] });
        continue;
      }
      const file = files.get(id);
      if (!file) continue;
      if (part === "AD") file.ads.push(record<OutreachAd>(item as unknown as Item & OutreachAd));
      else if (part === "S") file.sends.push(record<OutreachSend>(item as unknown as Item & OutreachSend));
      else if (part === "E") file.events.push(record<OutreachEvent>(item as unknown as Item & OutreachEvent));
    }
    return [...files.values()].sort((a, b) => Number(a.profile.test ?? false) - Number(b.profile.test ?? false) || a.profile.n - b.profile.n || a.profile.id.localeCompare(b.profile.id));
  }

  async find(id: string): Promise<Prospect | undefined> {
    const item = await this.table.get<Item & Prospect>(PK, profileKey(id));
    return item && record<Prospect>(item);
  }

  async get(id: string): Promise<Prospect> {
    const profile = await this.find(id);
    if (!profile) throw new Refusal(`There is no prospect ${id}.`);
    return profile;
  }

  /** Only the load and the making of a test prospect call this. */
  async saveProfile(profile: Prospect): Promise<void> {
    await this.table.put({ pk: PK, sk: profileKey(profile.id), ...profile });
  }

  async addEvent(id: string, body: OutreachEventBody, by: OutreachEvent["by"]): Promise<OutreachEvent> {
    const event = { ...body, id: randomUUID().slice(0, 8), at: this.now().toISOString(), by } as OutreachEvent;
    await this.table.put({ pk: PK, sk: eventKey(id, event.at, event.id), ...event });
    return event;
  }

  /** Attaches an ad under the next free number. */
  async addAd(id: string, ad: Omit<OutreachAd, "n" | "at">, from = 1): Promise<OutreachAd> {
    for (let n = from; n <= ADS_MAX; n++) {
      const saved: OutreachAd = { ...ad, n, at: this.now().toISOString() };
      if (await this.table.put({ pk: PK, sk: adKey(id, n), ...saved }, { ifNotExists: true })) return saved;
    }
    throw new Refusal(`Prospect ${id} has ${ADS_MAX} ads already.`);
  }

  /**
   * Takes an owner's upload for one call to work on. False when another call holds it, so one upload is one ad.
   * A call that was cut off (the server stops one after 29 seconds) cannot give its upload back, so a hold older than a minute is taken over.
   */
  async claimUpload(id: string, uploadId: string): Promise<boolean> {
    const sk = uploadKey(id, uploadId);
    const take = () => this.table.put({ pk: PK, sk, at: this.now().toISOString() }, { ifNotExists: true });
    if (await take()) return true;
    const held = await this.table.get<Item & { at: string }>(PK, sk);
    if (!held) return take();
    if (this.now().getTime() - Date.parse(held.at) < UPLOAD_HOLD_MS) return false;
    // Only one call removes the old hold: the others find its time changed or the hold gone.
    return (await this.table.delete(PK, sk, { ifEquals: { attribute: "at", value: held.at } })) && take();
  }

  /** Gives an upload back when the call that took it could not attach it, so it can be confirmed again. */
  async releaseUpload(id: string, uploadId: string): Promise<void> {
    await this.table.delete(PK, uploadKey(id, uploadId));
  }

  /** Saves an ad under one exact number. False when that number is taken: another attach came first. */
  async putAd(id: string, n: number, ad: Omit<OutreachAd, "n" | "at">): Promise<OutreachAd | undefined> {
    if (n > ADS_MAX) throw new Refusal(`Prospect ${id} has ${ADS_MAX} ads already.`);
    const saved: OutreachAd = { ...ad, n, at: this.now().toISOString() };
    return (await this.table.put({ pk: PK, sk: adKey(id, n), ...saved }, { ifNotExists: true })) ? saved : undefined;
  }

  /** Saves a step of the sequence once. False when that step is saved already. */
  async putSend(id: string, send: OutreachSend): Promise<boolean> {
    return this.table.put({ pk: PK, sk: sendKey(id, send.step), ...send }, { ifNotExists: true });
  }

  /** Takes a step back, only while it is still the send of that day. */
  async deleteSend(id: string, step: OutreachStep, day: string): Promise<boolean> {
    return this.table.delete(PK, sendKey(id, step), { ifEquals: { attribute: "day", value: day } });
  }

  /** The contacts that opted out, as register keys. */
  async optOuts(): Promise<Set<string>> {
    return new Set((await this.table.query<Item>(OPT_OUTS)).map((item) => item.sk));
  }

  /** An opt-out is kept for the contact, so it holds for every brand that shares it. It is never removed. */
  async addOptOut(profile: Prospect): Promise<void> {
    const at = this.now().toISOString();
    for (const key of contactKeys(profile)) await this.table.put({ pk: OPT_OUTS, sk: key, at, prospectId: profile.id });
  }

  /** Takes one place in a day's count of first messages. False when the day is full. */
  async takePlace(day: string, ceiling: number): Promise<boolean> {
    return this.table.add(DAYS, day, "n", 1, { ceiling });
  }

  async givePlace(day: string): Promise<void> {
    await this.table.add(DAYS, day, "n", -1);
  }

  async placesTaken(day: string): Promise<number> {
    return (await this.table.get<Item & { n?: number }>(DAYS, day))?.n ?? 0;
  }

  async setting<T>(name: string): Promise<T | undefined> {
    const item = await this.table.get<Item & { value: T }>(SETTINGS, name);
    return item?.value;
  }

  async saveSetting<T>(name: string, value: T, options: { ifNotExists?: boolean } = {}): Promise<boolean> {
    return this.table.put({ pk: SETTINGS, sk: name, value, at: this.now().toISOString() }, options);
  }

  /** Removes a test prospect with all its items. Nothing else can be removed. */
  async removeTest(id: string): Promise<number> {
    const profile = await this.get(id);
    if (!profile.test) throw new Refusal("Only a test prospect can be removed.");
    const items = (await this.table.query<Item>(PK)).filter((item) => item.sk === profileKey(id) || item.sk.startsWith(`${profileKey(id)}#`));
    // The profile goes last: a removal that stops half way can be run again.
    for (const item of items.sort((a, b) => b.sk.localeCompare(a.sk))) await this.table.delete(PK, item.sk);
    return items.length;
  }
}
