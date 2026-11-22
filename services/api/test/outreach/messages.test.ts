import { describe, expect, it } from "vitest";
import { address } from "../../src/outreach/load.js";
import { checkTemplate, fill, mailLink, messagesFor, profileLink, whatsappLink } from "../../src/outreach/messages.js";
import { profile } from "./helpers.js";

const template = { titles: ["New ad for {Brand}", "{Brand}, I made this for you"] as [string, string], body: "Hi, I made this ad for {Brand}.\n\nReply no to opt out." };

describe("a message", () => {
  it("fills the brand's name into the chosen title and the text", () => {
    expect(fill(template, "Kopi & Co", 0)).toEqual({ title: "New ad for Kopi & Co", text: "Hi, I made this ad for Kopi & Co.\n\nReply no to opt out." });
    expect(fill(template, "Kopi & Co", 1).title).toBe("Kopi & Co, I made this for you");
  });

  it("keeps a brand name with a dollar sign or a line break as plain text on one line", () => {
    expect(fill(template, "Cash $& Carry\nPte", 0).title).toBe("New ad for Cash $& Carry Pte");
  });

  it("makes a WhatsApp link with only digits and the encoded text", () => {
    const link = whatsappLink("6580000001", "Kopi & Co #1, for you", "Line one\nLine two?")!;
    expect(link).toBe("https://wa.me/6580000001?text=Kopi%20%26%20Co%20%231%2C%20for%20you%0A%0ALine%20one%0ALine%20two%3F");
    expect(new URL(link).searchParams.get("text")).toBe("Kopi & Co #1, for you\n\nLine one\nLine two?");
    expect(whatsappLink("+6580000001", "t", "x")).toBeUndefined();
    expect(whatsappLink("6580000001?text=x", "t", "x")).toBeUndefined();
  });

  it("makes a mail link with subject and text, and none from an address that could add a field", () => {
    const link = mailLink("hello@brand.example", "Kopi & Co #1", "Line one\nLine two")!;
    expect(link).toBe("mailto:hello@brand.example?subject=Kopi%20%26%20Co%20%231&body=Line%20one%0ALine%20two");
    expect(mailLink("hello@brand.example?bcc=x@y.example", "t", "x")).toBeUndefined();
    expect(mailLink("a@b.example,c@d.example", "t", "x")).toBeUndefined();
  });

  it("makes a mail link for every address the list accepts, with the part before the @ encoded", () => {
    for (const local of ["sales&support", "a?subject=x", "50%off", "tag#1", "first.last+ads"]) {
      const accepted = address(`${local}@brand.example`)!;
      const link = mailLink(accepted, "Title", "Text")!;
      expect(link, local).toBe(`mailto:${encodeURIComponent(local)}@brand.example?subject=Title&body=Text`);
      expect([...new URL(link).searchParams.keys()], local).toEqual(["subject", "body"]);
    }
  });

  it("gives both versions with the link of the brand's channel", () => {
    const [first, second] = messagesFor(template, profile(1), "whatsapp");
    expect(first.href).toMatch(/^https:\/\/wa\.me\/6580000001\?text=New%20ad/);
    expect(second.title).toBe("Brand 1, I made this for you");
    expect(messagesFor(template, profile(1), "email")[0].href).toMatch(/^mailto:hello@brand1\.example\?subject=New%20ad/);
    expect(messagesFor(template, profile(1, { whatsapp: [] }), "whatsapp")[0].href).toBeUndefined();
  });

  it("refuses a template with a placeholder it does not know, an empty text and a title of two lines", () => {
    expect(checkTemplate(template, "the first message")).toEqual(template);
    expect(() => checkTemplate({ ...template, body: "Hi {Name}" }, "the first message")).toThrow(/holds "\{Name\}", which is not the placeholder \{Brand\}/);
    expect(() => checkTemplate({ ...template, body: "Hi\n[ad image]" }, "the first message")).toThrow(/holds "\[ad image\]"/);
    expect(() => checkTemplate({ ...template, body: "Hi {Brand" }, "the first message")).toThrow(/holds "\{"/);
    expect(() => checkTemplate({ ...template, body: "  " }, "follow-up 1")).toThrow(/text of follow-up 1 is empty/);
    expect(() => checkTemplate({ ...template, titles: ["a\nb", "c"] }, "follow-up 1")).toThrow(/one line/);
  });

  it("links Instagram and LinkedIn only for a plain name or an https address on that site", () => {
    expect(profileLink("instagram", "brand.sg")).toBe("https://www.instagram.com/brand.sg/");
    expect(profileLink("instagram", "https://www.instagram.com/brand.sg/")).toBe("https://www.instagram.com/brand.sg/");
    expect(profileLink("instagram", "javascript:alert(1)")).toBeUndefined();
    expect(profileLink("linkedin", "https://www.linkedin.com/in/a-person")).toBe("https://www.linkedin.com/in/a-person");
    expect(profileLink("linkedin", "http://www.linkedin.com/in/a-person")).toBeUndefined();
    expect(profileLink("linkedin", "https://linkedin.com.evil.example/in/a")).toBeUndefined();
    expect(profileLink("linkedin", "https://user" + "@www.linkedin.com/in/a")).toBeUndefined();
    expect(profileLink("linkedin", undefined)).toBeUndefined();
  });
});
