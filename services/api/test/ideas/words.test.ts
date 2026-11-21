import { describe, expect, it } from "vitest";
import { wordFaults } from "../../src/ideas/checks.js";

const OFFER = "a top-of-funnel ad names no price, saving or delivery offer";
const facts = [{ claim: "20% off the first order", quote: "Save 20% on your first order. Next-day delivery." }];
const truth = (headline: string, subline: string, stage: "tof" | "mof" | "bof" = "tof") => wordFaults({ headline, subline, stage }, facts).truth;

describe("the offer in the words of a top-of-funnel ad", () => {
  // Found by review, 22-11-2026: the first pattern knew only "S$9", "20% off" and "free delivery".
  it.each([
    ["THE SKIN IS THE BEST PART.", "Next-day delivery."],
    ["SAVE 20% TODAY.", "The skin is the best part."],
    ["THE SKIN IS THE BEST PART.", "Save up to $20."],
    ["THE SKIN IS THE BEST PART.", "20% off."],
    ["THE SKIN IS THE BEST PART.", "S$9.50 a bag."],
    ["THE SKIN IS THE BEST PART.", "Free shipping."],
    ["THE SKIN IS THE BEST PART.", "Delivered to your door."],
    ["ONE-FOR-ONE.", "The skin is the best part."],
    ["THE SKIN IS THE BEST PART.", "Buy two, get one."],
    ["THE SKIN IS THE BEST PART.", "Use the promo code."],
  ])("refuses %s %s", (headline, subline) => {
    expect(truth(headline, subline)).toContain(OFFER);
  });

  it.each([
    ["THE SKIN IS THE BEST PART.", "You cannot stop."],
    ["SAVE THE LAST PIECE.", "Or do not."],
    ["20 PIECES. NONE THE SAME.", "Made by hand."],
  ])("lets %s %s through", (headline, subline) => {
    expect(truth(headline, subline)).not.toContain(OFFER);
  });

  it("leaves the offer to the middle and the bottom of the funnel", () => {
    expect(truth("SAVE 20% TODAY.", "Next-day delivery.", "bof")).not.toContain(OFFER);
    expect(truth("SAVE 20% TODAY.", "Next-day delivery.", "mof")).not.toContain(OFFER);
  });
});
