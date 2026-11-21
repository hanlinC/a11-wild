/** A time on the reader's own clock, with the time zone named, so that no one has to guess it. */
const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const ZONE = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" });

export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = ZONE.formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  return zone ? `${WHEN.format(date)} ${zone}` : WHEN.format(date);
}

export const usd = (amount: number): string => `US$${amount.toFixed(amount !== 0 && Math.abs(amount) < 0.01 ? 3 : 2)}`;
