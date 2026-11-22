/**
 * Sending days: Monday to Friday on the Singapore clock, without Singapore's public holidays.
 * A day is a string, YYYY-MM-DD, so no time zone can move it.
 */

/**
 * Singapore's public holidays, read from the Ministry of Manpower's list (mom.gov.sg, "Public holidays") on 22-11-2026.
 * A holiday on a Sunday makes the Monday after it a holiday; those Mondays are in the list.
 * The list ends with 2027: from 2028 only Saturdays and Sundays are left out until it is extended.
 */
const HOLIDAYS: ReadonlySet<string> = new Set([
  "2026-01-01",
  "2026-02-17",
  "2026-02-18",
  "2026-03-21",
  "2026-04-03",
  "2026-05-01",
  "2026-05-27",
  "2026-05-31",
  "2026-06-01",
  "2026-08-09",
  "2026-08-10",
  "2026-11-08",
  "2026-11-09",
  "2026-12-25",
  "2027-01-01",
  "2027-02-06",
  "2027-02-07",
  "2027-02-08",
  "2027-03-10",
  "2027-03-26",
  "2027-05-01",
  "2027-05-17",
  "2027-05-20",
  "2027-08-09",
  "2027-10-28",
  "2027-12-25",
]);

/** The last year the holiday list covers. */
export const HOLIDAYS_UNTIL = 2027;

const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The day it is in Singapore at this moment. Singapore has no summer time. */
export const singaporeDay = (at: Date): string => new Date(at.getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(0, 10);

const noon = (day: string): Date => new Date(`${day}T12:00:00Z`);

/** The day a number of calendar days later. */
export const addDays = (day: string, days: number): string => new Date(noon(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);

export function isSendingDay(day: string): boolean {
  const weekday = noon(day).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(day);
}

/** This day when it is a sending day, else the first one after it. */
export function sendingDayFrom(day: string): string {
  let next = day;
  while (!isSendingDay(next)) next = addDays(next, 1);
  return next;
}

/** The first sending day after this day. */
export const nextSendingDay = (day: string): string => sendingDayFrom(addDays(day, 1));

/** The day a follow-up is due: a number of calendar days after the message before it, moved to a sending day. */
export const dueDay = (sentDay: string, gapDays: number): string => sendingDayFrom(addDays(sentDay, gapDays));
