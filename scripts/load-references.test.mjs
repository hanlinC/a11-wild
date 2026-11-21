import { describe, expect, it } from "vitest";
import { manifestFaults, pictureType, referenceRow } from "./load-references.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const entry = { file: "one.png", kinds: ["v2", "v3", "v2"], brand: " Brand ", title: "A HEADLINE.", why: "One device, one claim." };

describe("load-references", () => {
  it("accepts a good manifest and names each fault of a bad one", () => {
    expect(manifestFaults([entry])).toEqual([]);
    expect(manifestFaults([])).toHaveLength(1);
    expect(manifestFaults([{ ...entry, kinds: ["v4"], why: "", loose: "yes" }])).toEqual([
      "Entry 1: kinds is a list of v1, v2 or v3.",
      "Entry 1: why is 1 to 500 characters.",
      "Entry 1: loose is true or false.",
    ]);
  });

  it("tells a picture by its first bytes, not by its name", () => {
    expect(pictureType(PNG)?.ext).toBe("png");
    expect(pictureType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(pictureType(Buffer.from("<svg onload=alert(1)>"))).toBeUndefined();
    expect(() => referenceRow({ ...entry, file: "bad.png" }, Buffer.from("not a picture"), new Date(0), "owner")).toThrow("bad.png is not a PNG, JPEG or WebP picture.");
  });

  it("makes one row for one picture, under the references folder", () => {
    const first = referenceRow(entry, PNG, new Date(0), "owner");
    const again = referenceRow({ ...entry, title: "OTHER" }, PNG, new Date(5), "owner");
    expect(first.key).toMatch(/^references\/[0-9a-f]{32}\.png$/);
    expect(again.key).toBe(first.key);
    expect(first.item).toMatchObject({ pk: "REFS", kinds: ["v2", "v3"], brand: "Brand", picture: { key: first.key }, addedAt: "1970-01-01T00:00:00.000Z" });
    expect(first.item).not.toHaveProperty("loose");
    expect(referenceRow({ ...entry, loose: true }, PNG, new Date(0), "owner").item.loose).toBe(true);
  });
});
