import type { MetaVariant } from "@a11-wild/shared";
import { describe, expect, it } from "vitest";
import { metaFaults } from "../../src/meta/checks.js";

const picture = { headline: "THE SKIN IS | THE BEST PART.", subline: "Salted egg, on every piece." };
const facts = [{ claim: "A bag is S$9.50", quote: "S$9.50" }];
const variant = (extra: Partial<MetaVariant> = {}): MetaVariant => ({
  primary: "The skin is the best part. We fry it until it curls, then coat every piece in salted egg. Order yours today.",
  headline: "The skin, done right",
  description: "Order the salted egg fish skin",
  cta: "Order Now",
  ...extra,
});

describe("the Meta text of one ad", () => {
  it("passes text that opens with the picture's line and names no number", () => {
    expect(metaFaults([variant(), variant({ primary: "Salted egg, on every piece. That is the whole idea. Order yours today." })], { picture, stage: "tof", facts })).toEqual({ truth: [], notes: [] });
  });

  it("refuses a primary text that does not open with the picture's own line", () => {
    const { truth } = metaFaults([variant(), variant({ primary: "Crunch that you cannot put down. Order yours today." })], { picture, stage: "mof", facts });
    expect(truth).toEqual(['variant B: the primary text opens with the picture\'s own line ("THE SKIN IS THE BEST PART." or "Salted egg, on every piece.")']);
  });

  it("refuses a number that no saved fact holds, in any field", () => {
    const { truth } = metaFaults([variant({ description: "Loved by 20,000 buyers" }), variant()], { picture, stage: "bof", facts });
    expect(truth).toEqual(["variant A: no saved fact holds the number 20000"]);
    expect(metaFaults([variant({ description: "S$9.50 a bag" }), variant()], { picture, stage: "bof", facts }).truth).toEqual([]);
  });

  it("refuses an offer in the text of a top-of-funnel ad, and leaves it to the other stages", () => {
    const offer = variant({ description: "Free delivery today" });
    expect(metaFaults([offer, variant()], { picture, stage: "tof", facts }).truth).toEqual(["variant A: the text of a top-of-funnel ad names no price, saving or delivery offer"]);
    expect(metaFaults([offer, variant()], { picture, stage: "bof", facts }).truth).toEqual([]);
  });

  it("asks no opening line of a picture with no words, and only notes a long text", () => {
    const long = variant({ primary: `No words on this one. ${"It goes on and on. ".repeat(8)}`, headline: "A headline that is a good deal longer than forty characters" });
    const { truth, notes } = metaFaults([long, variant()], { facts });
    expect(truth).toEqual([]);
    expect(notes).toEqual([expect.stringMatching(/variant A: the primary text has \d+ characters, and the first 125 show/), expect.stringMatching(/variant A: the headline has \d+ characters/)]);
  });
});
