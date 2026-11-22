import { describe, expect, it } from "vitest";
import { findingsOf, plainReason } from "../../src/outreach/candidates.js";

describe("what the checks found in a draft, as the owner reads it", () => {
  // The lines are the pixel tools' own, as the live studio saved them on 22-11-2026.
  it("says how far the pack is from its photo, with no pixels and no ratios", () => {
    expect(plainReason({ tool: "pack_check", note: "render H/W 0.922 (486 x 527 px); packshot H/W 1.000; difference -7.8%; FAIL at 2%" })).toBe(
      "The pack is drawn 8% wider than in its photo. The limit is 2%.",
    );
    expect(plainReason({ tool: "pack_check", note: "render H/W 2.583 (465 x 180 px); packshot H/W 1.544; difference +67.3%; FAIL at 2%" })).toBe(
      "The pack is drawn 67% taller than in its photo. The limit is 2%.",
    );
    expect(plainReason({ tool: "pack_check", note: "Pack 2: render H/W 1.961 (708 x 361 px); packshot H/W 2.152; difference -8.8%; FAIL at 2%" })).toBe(
      "Pack 2: The pack is drawn 10% wider than in its photo. The limit is 2%.",
    );
  });

  it("gives the width against the photo's width, not the fall of the tool's ratio", () => {
    // Height over width 20% under the photo's is a pack a quarter wider at the same height.
    expect(plainReason({ tool: "pack_check", note: "render H/W 0.800 (400 x 500 px); packshot H/W 1.000; difference -20.0%; FAIL at 2%" })).toBe(
      "The pack is drawn 25% wider than in its photo. The limit is 2%.",
    );
  });

  it("says where the cap sits", () => {
    expect(plainReason({ tool: "cap_check", note: "cap centre 12.3 px left of the body centre (3.1% of the 400 px body; the part in rows 10 to 60); FAIL at 1%" })).toBe(
      "The cap sits 3% to the left of the middle of the pack. The limit is 1%.",
    );
  });

  it("gives the agent's own line, and a tool's line it does not know, as they are", () => {
    expect(plainReason({ note: "Invented plants and foliage at the left edge." })).toBe("Invented plants and foliage at the left edge.");
    expect(plainReason({ tool: "pack_check", note: "The pack was not found at that point." })).toBe("The pack was not found at that point.");
  });

  const measured = { code: "D11" as const, tool: "pack_check", note: "render H/W 0.955 (486 x 509 px); packshot H/W 1.000; difference -4.5%; FAIL at 2%" };
  const of = (items: { code: "D11" | "D4" | "F1"; note: string; tool?: string }[]) => ({ checks: { imageId: "a", looked: true, savedAt: "", items } });

  it("says what the pack measure found, each finding once", () => {
    expect(findingsOf(of([measured]))).toEqual(["The pack is drawn 5% wider than in its photo. The limit is 2%."]);
    expect(findingsOf(of([measured, measured]))).toEqual(["The pack is drawn 5% wider than in its photo. The limit is 2%."]);
    expect(findingsOf(of([]))).toEqual([]);
  });

  it("says what the agent saw as the agent's, beside what a tool measured, and what was found with the words on, one line each", () => {
    expect(findingsOf(of([measured, { code: "D4", note: "Invented leaves at the left edge." }]))).toEqual([
      "The pack is drawn 5% wider than in its photo. The limit is 2%.",
      "The agent saw: Invented leaves at the left edge.",
    ]);
    expect(findingsOf(of([{ code: "F1", note: "Soft edge" }]))).toEqual(["The agent saw: Soft edge."]);
    expect(findingsOf(of([{ code: "D11", tool: "cap_check", note: "cap centre 14.0 px left of the body centre (4.1% of the body width); FAIL at 1%" }]))[0]).toMatch(/^The cap sits 4% to the left of the middle of the pack\./);
    const words = { checks: { imageId: "w", looked: true, savedAt: "", items: [{ code: "F2" as const, note: "The subline sits close to the pack." }] } };
    expect(findingsOf({ ...of([measured]), words } as Parameters<typeof findingsOf>[0])).toEqual([
      "The pack is drawn 5% wider than in its photo. The limit is 2%.",
      "The agent saw: The subline sits close to the pack.",
    ]);
  });
});
