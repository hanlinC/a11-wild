import { describe, expect, it } from "vitest";
import { wordsAsked } from "../../src/render/prompt-guard.js";

describe("prompt guard (R16)", () => {
  it("finds a prompt that asks for words in the picture", () => {
    expect(wordsAsked("The pack on a rock, with the headline above it in bold white.")).toBe("headline");
    expect(wordsAsked("A chalk board sign that says fresh today, beside the pack.")).toMatch(/sign that says/);
    expect(wordsAsked('The pack on a rock. Add "Dangerously addictive" at the top.')).toMatch(/Dangerously addictive/);
    expect(wordsAsked("A handwritten note leans on the jar.")).toBe("handwritten");
    expect(wordsAsked("A buy now button in the lower third.")).toBe("button");
  });

  it("passes a prompt that describes the scene only", () => {
    expect(wordsAsked("The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it, the brand logo small in the lower right corner.")).toBeUndefined();
    expect(wordsAsked("Macro shot of one crisp held between two fingers, the pack out of focus behind, soft window light from the left.")).toBeUndefined();
  });
});
