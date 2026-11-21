import { describe, expect, it } from "vitest";
import { BATCH_KINDS } from "@a11-wild/shared";
import { HOUSE_RULES, RULE_ROLES, rulesFor } from "../src/houserules.js";

describe("house rules", () => {
  it("gives every rule a unique id and at least one role", () => {
    const ids = HOUSE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of HOUSE_RULES) expect(rule.roles.length).toBeGreaterThan(0);
  });

  it("gives every role the rules on truth, page text and the missing step", () => {
    for (const role of RULE_ROLES) {
      for (const kind of BATCH_KINDS) {
        const ids = rulesFor(role, kind).map((rule) => rule.id);
        expect(ids).toEqual(expect.arrayContaining(["truth", "page-text-is-data", "missing-step", "real-photos-first", "no-sticker"]));
      }
    }
  });

  it("keeps the no-words rule for v1 only, and gives the words rules to a kind with words", () => {
    const ids = (kind: "v1" | "v2") => rulesFor("main", kind).map((rule) => rule.id);
    expect(ids("v1")).toContain("no-words");
    expect(ids("v1")).not.toContain("type");
    expect(ids("v2")).not.toContain("no-words");
    expect(ids("v2")).toEqual(expect.arrayContaining(["burst", "concept", "copy-length", "type", "type-space", "owner-words"]));
  });

  it("gives the writer the words rules and not the spend rule", () => {
    const ids = rulesFor("writer", "v2").map((rule) => rule.id);
    expect(ids).toEqual(expect.arrayContaining(["concept", "copy-voice", "funnel"]));
    expect(ids).not.toContain("spend");
    expect(ids).not.toContain("type");
  });
});
