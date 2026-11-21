import { describe, expect, it } from "vitest";
import { adName, brandSlug, singaporeWeek } from "../../src/meta/names.js";

describe("the week of an ad name", () => {
  it("is counted on the Singapore clock at the Monday boundary", () => {
    // Sunday 22-11-2026 15:59 UTC is still Sunday 23:59 in Singapore: week 47.
    expect(singaporeWeek(new Date("2026-11-22T15:59:00Z"))).toBe(47);
    // One minute later it is Monday 00:00 in Singapore: week 48, though UTC still says Sunday.
    expect(singaporeWeek(new Date("2026-11-22T16:00:00Z"))).toBe(48);
  });

  it("follows the ISO rule at the turn of a year", () => {
    // Friday 01-01-2027 belongs to week 53 of 2026; Monday 04-01-2027 starts week 1.
    expect(singaporeWeek(new Date("2027-01-01T04:00:00Z"))).toBe(53);
    expect(singaporeWeek(new Date("2027-01-04T04:00:00Z"))).toBe(1);
    expect(singaporeWeek(new Date("2026-01-01T04:00:00Z"))).toBe(1);
  });
});

describe("an ad name", () => {
  const at = new Date("2026-11-22T04:00:00Z");

  it("holds the week, the brand, the batch number, the stage, the idea and the version", () => {
    expect(adName({ at, brand: "IRVINS", batchNumber: 2, stage: "tof", idea: 1, version: 1 })).toBe("a11_W47_irvins_b02_tof_c1_v1");
    expect(adName({ at, brand: "Cat & the Fiddle", batchNumber: 11, stage: "bof", idea: 3, version: 4 })).toBe("a11_W47_catthefiddle_b11_bof_c3_v4");
  });

  it("names a picture with no words wild, and keeps two batches of one brand apart", () => {
    const first = adName({ at, brand: "Oatside", batchNumber: 1, idea: 2, version: 1 });
    expect(first).toBe("a11_W47_oatside_b01_wild_c2_v1");
    expect(adName({ at, brand: "Oatside", batchNumber: 2, idea: 2, version: 1 })).not.toBe(first);
  });

  it("makes a slug of plain letters from any brand name", () => {
    expect(brandSlug("Café Crème No. 5")).toBe("cafecremeno5");
    expect(brandSlug("好")).toBe("brand");
  });
});
