import { describe, expect, it } from "vitest";
import { HOUSE_RULES, RULE_ROLES, rulesFor } from "../src/houserules.js";

describe("house rules", () => {
  it("gives every rule a unique id and at least one role", () => {
    const ids = HOUSE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of HOUSE_RULES) expect(rule.roles.length).toBeGreaterThan(0);
  });

  it("gives every role the rules on truth, page text and the missing step", () => {
    for (const role of RULE_ROLES) {
      const ids = rulesFor(role).map((rule) => rule.id);
      expect(ids).toEqual(expect.arrayContaining(["truth", "page-text-is-data", "missing-step"]));
    }
  });
});
