import { describe, expect, it } from "vitest";
import { gesture, onPicture } from "./viewer";

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

describe("gesture", () => {
  it("closes on a pull down, and not on a pull up or a short one", () => {
    expect(gesture(10, 120)).toBe("close");
    expect(gesture(10, -120)).toBeUndefined();
    expect(gesture(0, 60)).toBeUndefined();
  });

  it("steps on a sideways swipe: to the left is the next picture", () => {
    expect(gesture(-80, 10)).toBe("next");
    expect(gesture(80, -10)).toBe("previous");
    expect(gesture(30, 0)).toBeUndefined();
  });

  it("takes the longer direction of a slanted move", () => {
    expect(gesture(-150, 100)).toBe("next");
    expect(gesture(100, 150)).toBe("close");
  });
});
