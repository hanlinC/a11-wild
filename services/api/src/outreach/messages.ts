import type { OutreachChannel, OutreachMessage, OutreachTemplate, Prospect } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";

/** The only placeholder of a message. */
export const BRAND = "{Brand}";

const TITLE_MAX = 200;
const BODY_MAX = 4000;

/** Refuses a text with a placeholder the system does not know: it would reach a person unfilled. */
export function checkTemplate(template: OutreachTemplate, what: string): OutreachTemplate {
  const titles = template.titles.map((title) => title.trim()) as [string, string];
  const body = template.body.replace(/\r\n/g, "\n").trim();
  for (const [name, text, max] of [
    ["first title", titles[0], TITLE_MAX],
    ["second title", titles[1], TITLE_MAX],
    ["text", body, BODY_MAX],
  ] as const) {
    if (text === "") throw new Refusal(`The ${name} of ${what} is empty.`);
    if (text.length > max) throw new Refusal(`The ${name} of ${what} is longer than ${max} characters.`);
    // The whole unknown placeholder is named when there is one, so the owner sees which word to change.
    const unknown = text.replace(/\{Brand\}/g, "").match(/\{[^{}\n]*\}|\[[^[\]\n]*\]|[{}[\]]/);
    if (unknown) throw new Refusal(`The ${name} of ${what} holds "${unknown[0]}", which is not the placeholder ${BRAND}. Take it out, or write ${BRAND}.`);
  }
  if (titles.some((title) => /\n/.test(title))) throw new Refusal(`A title of ${what} is one line.`);
  return { titles, body };
}

/** The brand's name as one line, so it cannot break a title. */
const oneLine = (brand: string) => brand.replace(/\s+/g, " ").trim();

/** The message with the brand's name filled in. The text the owner copies is the text that is saved when he marks it as sent. */
export function fill(template: OutreachTemplate, brand: string, title: 0 | 1): { title: string; text: string } {
  const name = oneLine(brand);
  // A function as the replacement: a "$" in a brand's name is then a plain character.
  const put = (text: string) => text.replace(/\{Brand\}/g, () => name);
  return { title: put(template.titles[title]), text: put(template.body) };
}

/** A WhatsApp link from a checked number: digits only. The title is the first line of the text. */
export function whatsappLink(number: string, title: string, text: string): string | undefined {
  if (!/^\d{10,15}$/.test(number)) return undefined;
  return `https://wa.me/${number}?text=${encodeURIComponent(`${title}\n\n${text}`)}`;
}

/** An address the list may hold. The link below encodes the part before the @, so a mark such as & or ? in it cannot add a field to the link. */
export const EMAIL = /^[^@\s<>"',;:\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A mail link from a checked address, with the title as its subject. */
export function mailLink(address: string, title: string, text: string): string | undefined {
  if (!EMAIL.test(address)) return undefined;
  const [local, domain] = address.split("@") as [string, string];
  return `mailto:${encodeURIComponent(local)}@${domain}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
}

/** Both versions of a message for one prospect, each with its link for the channel. */
export function messagesFor(template: OutreachTemplate, profile: Prospect, channel: OutreachChannel | undefined): [OutreachMessage, OutreachMessage] {
  const one = (index: 0 | 1): OutreachMessage => {
    const { title, text } = fill(template, profile.brand, index);
    const href = channel === "whatsapp" && profile.whatsapp[0] ? whatsappLink(profile.whatsapp[0], title, text) : channel === "email" && profile.email ? mailLink(profile.email, title, text) : undefined;
    return { title, text, ...(href ? { href } : {}) };
  };
  return [one(0), one(1)];
}

/** An Instagram or LinkedIn value as a link, only when it is an https address on that site or a plain Instagram name. Else it is shown as text. */
export function profileLink(kind: "instagram" | "linkedin", value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (kind === "instagram" && /^@?[A-Za-z0-9._]{1,30}$/.test(value)) return `https://www.instagram.com/${value.replace(/^@/, "")}/`;
  let url: URL;
  try {
    // The list gives LinkedIn pages without "https://".
    url = new URL(/^(www\.|sg\.)?linkedin\.com\//.test(value) && kind === "linkedin" ? `https://${value}` : value);
  } catch {
    return undefined;
  }
  const hosts = kind === "instagram" ? ["instagram.com", "www.instagram.com"] : ["linkedin.com", "www.linkedin.com", "sg.linkedin.com"];
  return url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : undefined;
}
