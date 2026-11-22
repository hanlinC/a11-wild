import { describe, expect, it } from "vitest";
import { addDays, dueDay, isSendingDay, nextSendingDay, sendingDayFrom, singaporeDay } from "../../src/outreach/days.js";

describe("sending days", () => {
  it("uses the Singapore clock", () => {
    // 23:30 on Monday in Singapore is 15:30 UTC on Monday.
    expect(singaporeDay(new Date("2026-11-23T15:30:00Z"))).toBe("2026-11-23");
    // 00:30 on Tuesday in Singapore is 16:30 UTC on Monday.
    expect(singaporeDay(new Date("2026-11-23T16:30:00Z"))).toBe("2026-11-24");
  });

  it("leaves out a Saturday, a Sunday and a public holiday", () => {
    expect(isSendingDay("2026-11-23")).toBe(true);
    expect(isSendingDay("2026-11-28")).toBe(false);
    expect(isSendingDay("2026-11-29")).toBe(false);
    expect(isSendingDay("2026-12-25")).toBe(false);
    // Deepavali 2026 is on a Sunday, so the Monday after it is a holiday.
    expect(isSendingDay("2026-11-09")).toBe(false);
  });

  it("gives the next sending day", () => {
    expect(nextSendingDay("2026-11-27")).toBe("2026-11-30");
    expect(nextSendingDay("2026-11-28")).toBe("2026-11-30");
    expect(nextSendingDay("2026-12-24")).toBe("2026-12-28");
    expect(sendingDayFrom("2026-11-23")).toBe("2026-11-23");
    expect(sendingDayFrom("2027-02-06")).toBe("2027-02-09");
  });

  it("puts follow-up 1 of a Friday's first message on the Monday, and on the Tuesday when the Monday is a holiday", () => {
    expect(dueDay("2026-11-27", 3)).toBe("2026-11-30");
    // Friday 6 November 2026: three days later is Monday 9 November, a holiday.
    expect(dueDay("2026-11-06", 3)).toBe("2026-11-10");
    expect(dueDay("2026-11-23", 3)).toBe("2026-11-26");
    expect(dueDay("2026-11-26", 4)).toBe("2026-11-30");
  });

  it("adds days across a month and a year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
