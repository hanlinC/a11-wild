import type { OutreachChannel, OutreachEvent, OutreachSend, OutreachStep, OutreachTemplates, ProspectFile } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { dueDay, singaporeDay } from "./days.js";
import { checkTemplate, fill } from "./messages.js";
import { channelOf, newestAd, optedOut, stageOf, verdictOf } from "./stage.js";
import { contactKeys, type OutreachStore } from "./store.js";

/** The owner's sequence: follow-up 1 three days after the first message, follow-up 2 four days after follow-up 1. */
export const GAP_DAYS: Record<1 | 2, number> = { 1: 3, 2: 4 };
export const STEP_NAMES = ["the first message", "follow-up 1", "follow-up 2"] as const;

export const DAILY = { name: "DAILY", standard: 5, min: 1, max: 20 } as const;
const TEMPLATES = "TEMPLATES";

/** The next message of a contacted prospect and the day it is due, or nothing when the sequence is over. */
export function nextStep(file: ProspectFile): { step: 1 | 2; due: string } | undefined {
  if (file.events.some((event) => event.type === "reply")) return undefined;
  const sent = new Map(file.sends.map((send) => [send.step, send]));
  const first = sent.get(0);
  if (!first) return undefined;
  const one = sent.get(1);
  if (!one) return { step: 1, due: dueDay(first.day, GAP_DAYS[1]) };
  return sent.has(2) ? undefined : { step: 2, due: dueDay(one.day, GAP_DAYS[2]) };
}

/**
 * For each prospect that shares a number or an address with one earlier in the list: that earlier one.
 * Only the first is offered a first message, so one person does not get it twice. A test prospect shares with nobody.
 */
export function sameContact(files: ProspectFile[]): Map<string, ProspectFile> {
  const first = new Map<string, ProspectFile>();
  const shared = new Map<string, ProspectFile>();
  for (const file of files) {
    if (file.profile.test) continue;
    const keys = contactKeys(file.profile);
    const earlier = keys.map((key) => first.get(key)).find((found) => found !== undefined);
    if (earlier) shared.set(file.profile.id, earlier);
    for (const key of keys) if (!first.has(key)) first.set(key, file);
  }
  return shared;
}

export const chosen = (file: ProspectFile): boolean => file.events.some((event) => event.type === "chosen");

/** What the owner does by hand and records here. The server refuses what his rules do not allow. */
export class OutreachSequence {
  constructor(
    private readonly store: OutreachStore,
    private readonly now: () => Date,
  ) {}

  async daily(): Promise<number> {
    return (await this.store.setting<number>(DAILY.name)) ?? DAILY.standard;
  }

  async setDaily(n: number): Promise<number> {
    if (!Number.isInteger(n) || n < DAILY.min || n > DAILY.max) throw new Refusal(`The daily number of first messages is a whole number from ${DAILY.min} to ${DAILY.max}.`);
    await this.store.saveSetting(DAILY.name, n);
    return n;
  }

  async templates(): Promise<OutreachTemplates | undefined> {
    return this.store.setting<OutreachTemplates>(TEMPLATES);
  }

  /** The owner's own change to his messages. A message that was sent keeps the text it was sent with. */
  async saveTemplates(steps: OutreachTemplates["steps"], options: { onlyFirst?: boolean } = {}): Promise<OutreachTemplates | undefined> {
    const saved: OutreachTemplates = { steps: steps.map((step, index) => checkTemplate(step, STEP_NAMES[index]!)) as OutreachTemplates["steps"], savedAt: this.now().toISOString() };
    const written = await this.store.saveSetting(TEMPLATES, saved, options.onlyFirst ? { ifNotExists: true } : {});
    return written ? saved : undefined;
  }

  private async file(id: string): Promise<{ file: ProspectFile; files: ProspectFile[]; optOuts: Set<string> }> {
    const [files, optOuts] = await Promise.all([this.store.all(), this.store.optOuts()]);
    const file = files.find((entry) => entry.profile.id === id);
    if (!file) throw new Refusal(`There is no prospect ${id}.`);
    return { file, files, optOuts };
  }

  /** Records a message the owner sent by hand: the day, the channel and the exact text. A second mark of the same step changes nothing. */
  async send(id: string, input: { step: OutreachStep; title: 0 | 1 }): Promise<{ send: OutreachSend; already: boolean }> {
    const { file, files, optOuts } = await this.file(id);
    const { step } = input;
    const before = file.sends.find((send) => send.step === step);
    if (before) return { send: before, already: true };
    if (optedOut(file, optOuts)) throw new Refusal("This contact opted out. No message to it is recorded, and none should be sent.");
    const day = singaporeDay(this.now());
    const stage = stageOf(file, optOuts);
    if (step === 0) {
      if (stage !== "ready") throw new Refusal(`The first message goes only to a brand whose ad you said yes to. This one is at "${stage}".`);
      const earlier = sameContact(files).get(id);
      if (earlier && !chosen(file)) throw new Refusal(`This brand has the same contact as ${earlier.profile.brand}. Choose it first if you want to send to it too.`);
    } else {
      if (stage !== "contacted") throw new Refusal(`A follow-up goes only to a brand that got the first message and has not replied. This one is at "${stage}".`);
      const next = nextStep(file);
      if (next?.step !== step) throw new Refusal(next ? `The next message of this brand is ${STEP_NAMES[next.step]}.` : "This brand has had its last message.");
      if (next.due > day) throw new Refusal(`${STEP_NAMES[step]} of this brand is due on ${next.due}.`);
    }
    const templates = await this.templates();
    if (!templates) throw new Refusal("The message text is not loaded yet.");
    const channel = channelOf(file);
    if (!channel) throw new Refusal("This brand has no WhatsApp number and no verified address.");
    const counted = step === 0 && !file.profile.test;
    // The place in the day's count is taken first, so two marks at once cannot pass the day's number.
    if (counted) {
      const daily = await this.daily();
      if (!(await this.store.takePlace(day, daily))) throw new Refusal(`Today's ${daily} first messages are sent. More can go tomorrow, or raise the daily number.`);
    }
    const send: OutreachSend = { step, day, channel, ...fill(templates.steps[step], file.profile.brand, input.title), at: this.now().toISOString() };
    let put = false;
    try {
      put = await this.store.putSend(id, send);
    } finally {
      // The mark was not saved, or another mark of the same step came first: this one gives its place back.
      if (!put && counted) await this.store.givePlace(day);
    }
    if (put) return { send, already: false };
    const saved = (await this.file(id)).file.sends.find((entry) => entry.step === step);
    return { send: saved ?? send, already: true };
  }

  /** Takes a mark back on the day it was made. Only the newest step can be taken back. */
  async takeBack(id: string, step: OutreachStep): Promise<void> {
    const { file } = await this.file(id);
    const send = file.sends.find((entry) => entry.step === step);
    if (!send) throw new Refusal(`${STEP_NAMES[step]} of this brand is not marked as sent.`);
    if (file.sends.some((entry) => entry.step > step)) throw new Refusal("A later message of this brand is marked as sent. Take that one back first.");
    const day = singaporeDay(this.now());
    if (send.day !== day || !(await this.store.deleteSend(id, step, day))) throw new Refusal(`A mark can be taken back on its own day only. This one is of ${send.day}.`);
    // The place goes back before the note of it is written: the mark is gone, so the day must not count it.
    if (step === 0 && !file.profile.test) await this.store.givePlace(day);
    await this.store.addEvent(id, { type: "unsent", step }, "owner");
  }

  /** A reply the owner got. "no" is an opt-out, at once and for good. */
  async reply(id: string, input: { reply: "more" | "no" | "other"; text?: string | undefined }): Promise<OutreachEvent> {
    const { file } = await this.file(id);
    if (!file.sends.some((send) => send.step === 0)) throw new Refusal("A reply is logged for a brand that got the first message.");
    const event = await this.store.addEvent(id, { type: "reply", reply: input.reply, ...(input.text ? { text: input.text } : {}) }, "owner");
    if (input.reply === "no") await this.optOut(id);
    return event;
  }

  /** Final, and kept for the contact: every brand with that number or that address leaves every list. */
  async optOut(id: string): Promise<void> {
    const profile = await this.store.get(id);
    // The contact's own register is written first: if the second write fails, every brand with the contact is off the lists already, and a second try finishes it.
    // A test prospect's opt-out stays on the test prospect, so a test can neither block nor free a real contact.
    if (!profile.test) await this.store.addOptOut(profile);
    await this.store.addEvent(id, { type: "optout" }, "owner");
  }

  /** The owner's yes or no to an ad. Only his yes puts the brand in the sending queue. */
  async verdict(id: string, input: { ad: number; yes: boolean; ownerSaid?: string | undefined }): Promise<OutreachEvent> {
    const { file } = await this.file(id);
    const ad = file.ads.find((entry) => entry.n === input.ad);
    if (!ad) throw new Refusal(`This brand has no ad ${input.ad}.`);
    if (ad.n !== newestAd(file)?.n) throw new Refusal("Only the newest ad of a brand waits for a yes or a no.");
    const said = verdictOf(file, ad);
    // The final of his own pick has his yes from the pick. He can still say no to it once he has seen it, and then chooses among the drafts again.
    const ownPick = ad.picked === true && said?.type === "ad_yes" && !file.events.some((event) => event.id === said.id);
    if (said && !(ownPick && !input.yes)) throw new Refusal("This ad has its yes or no already.");
    if (input.yes) return this.store.addEvent(id, { type: "ad_yes", ad: ad.n }, "owner");
    if (ownPick) {
      if (file.sends.some((send) => send.at >= ad.at)) throw new Refusal("A message went out after this ad was attached. Pick another draft for the next message instead.");
      return this.store.addEvent(id, { type: "ad_no", ad: ad.n, ownerSaid: input.ownerSaid ?? "Not this after all." }, "owner");
    }
    if (!input.ownerSaid) throw new Refusal("A no needs your words: the next ad is made from them.");
    return this.store.addEvent(id, { type: "ad_no", ad: ad.n, ownerSaid: input.ownerSaid }, "owner");
  }

  async answered(id: string): Promise<OutreachEvent> {
    await this.store.get(id);
    return this.store.addEvent(id, { type: "answered" }, "owner");
  }

  async note(id: string, text: string): Promise<OutreachEvent> {
    await this.store.get(id);
    return this.store.addEvent(id, { type: "note", text }, "owner");
  }

  async setStage(id: string, stage: "in_talks" | "client" | "lost" | "parked" | "auto", reason?: string): Promise<OutreachEvent> {
    await this.store.get(id);
    return this.store.addEvent(id, { type: "stage", stage, ...(reason ? { reason } : {}) }, "owner");
  }

  async setChannel(id: string, channel: OutreachChannel): Promise<OutreachEvent> {
    const profile = await this.store.get(id);
    if (channel === "whatsapp" ? profile.whatsapp.length === 0 : !profile.email) throw new Refusal(channel === "whatsapp" ? "This brand has no WhatsApp number." : "This brand has no verified address.");
    return this.store.addEvent(id, { type: "channel", channel }, "owner");
  }

  /** The owner chooses to send to a brand that shares its contact with an earlier one. */
  async choose(id: string): Promise<OutreachEvent> {
    await this.store.get(id);
    return this.store.addEvent(id, { type: "chosen" }, "owner");
  }

  async setKind(id: string, kind: "product" | "service", by: OutreachEvent["by"]): Promise<OutreachEvent> {
    await this.store.get(id);
    return this.store.addEvent(id, { type: "kind", kind }, by);
  }
}
