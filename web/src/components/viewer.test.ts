import { describe, expect, it } from "vitest";
import { held, letsGo, onPicture, pinched, pulls } from "./viewer";

describe("onPicture", () => {
  // A 4:5 picture in a wide box: it is drawn 800 by 1000 in the middle, with 500 empty on each side.
  const wide = { left: 0, top: 0, width: 1800, height: 1000 };
  const ad = { width: 1024, height: 1280 };

  it("takes a point on the drawn picture, and not one in the empty part beside it", () => {
    expect(onPicture(wide, ad, 900, 500)).toBe(true);
    expect(onPicture(wide, ad, 501, 5)).toBe(true);
    expect(onPicture(wide, ad, 499, 500)).toBe(false);
    expect(onPicture(wide, ad, 1301, 500)).toBe(false);
  });

  it("finds the empty part above and below a picture in a tall box", () => {
    const tall = { left: 10, top: 20, width: 400, height: 900 };
    // Drawn 400 by 500, from 220 to 720 down the page.
    expect(onPicture(tall, ad, 200, 470)).toBe(true);
    expect(onPicture(tall, ad, 200, 219)).toBe(false);
    expect(onPicture(tall, ad, 200, 721)).toBe(false);
  });

  it("makes a small picture as large as the box, so its whole drawn size counts", () => {
    expect(onPicture(wide, { width: 240, height: 300 }, 510, 990)).toBe(true);
  });

  it("counts every point as on a picture that has not loaded, so a click closes nothing", () => {
    expect(onPicture(wide, { width: 0, height: 0 }, 5, 5)).toBe(true);
  });
});

describe("a finger on the large picture", () => {
  it("takes a move that goes down more than sideways as a pull, and leaves any other move to the browser", () => {
    expect(pulls(0, 40)).toBe(true);
    expect(pulls(20, 40)).toBe(true);
    expect(pulls(40, 40)).toBe(false);
    expect(pulls(-60, 10)).toBe(false);
    expect(pulls(0, -40)).toBe(false);
  });

  it("closes on a long pull or a short quick one, and on nothing less", () => {
    expect(letsGo(91, 0)).toBe(true);
    expect(letsGo(40, 0.6)).toBe(true);
    expect(letsGo(40, 0.2)).toBe(false);
    expect(letsGo(20, 2)).toBe(false);
  });
});

describe("two fingers on the large picture", () => {
  const fit = { scale: 1, x: 0, y: 0 };
  // A phone held upright and a 4:5 ad: fitted it is 390 by 487.5, with empty space above and below.
  const phone = { width: 390, height: 844 };
  const ad = { width: 1024, height: 1280 };

  it("draws the picture in by how far the fingers moved apart, and keeps the point between them under them", () => {
    const lens = pinched(fit, { x: 100, y: -50, apart: 120 }, { x: 100, y: -50, apart: 240 });
    expect(lens.scale).toBe(2);
    // The point 100 right of the middle is drawn 200 right of the picture's middle, so the middle goes 100 left.
    expect(lens).toMatchObject({ x: -100, y: 50 });
  });

  it("moves the picture with fingers that move together", () => {
    expect(pinched({ scale: 2, x: 10, y: 0 }, { x: 0, y: 0, apart: 100 }, { x: 30, y: -20, apart: 100 })).toEqual({ scale: 2, x: 40, y: -20 });
  });

  it("never makes it smaller than fitted or closer than four times", () => {
    expect(pinched(fit, { x: 0, y: 0, apart: 200 }, { x: 0, y: 0, apart: 50 }).scale).toBe(1);
    expect(pinched(fit, { x: 0, y: 0, apart: 20 }, { x: 0, y: 0, apart: 400 }).scale).toBe(4);
  });

  it("puts a fitted picture back in the middle", () => {
    expect(held({ scale: 1, x: 80, y: -40 }, phone, ad)).toEqual(fit);
    expect(held({ scale: 0.4, x: 80, y: -40 }, phone, ad)).toEqual(fit);
  });

  it("lets no edge of the picture come inside the edge of the screen", () => {
    // Twice: 780 wide, so 195 free on each side; 975 high, so 65.5 free above and below.
    expect(held({ scale: 2, x: 500, y: -500 }, phone, ad)).toEqual({ scale: 2, x: 195, y: -65.5 });
    expect(held({ scale: 2, x: -120, y: 30 }, phone, ad)).toEqual({ scale: 2, x: -120, y: 30 });
  });

  it("keeps a side that is still smaller than the screen in the middle", () => {
    // One and a half times: 731 high on a screen of 844, so it does not move up or down.
    expect(held({ scale: 1.5, x: 40, y: 200 }, phone, ad)).toEqual({ scale: 1.5, x: 40, y: 0 });
  });

  it("holds a picture that has not loaded as if it filled the screen", () => {
    expect(held({ scale: 2, x: 999, y: 999 }, phone, { width: 0, height: 0 })).toEqual({ scale: 2, x: 195, y: 422 });
  });
});
