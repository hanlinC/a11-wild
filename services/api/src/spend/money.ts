/** Money is held as whole millionths of a US dollar, so sums never drift. */
export const toMicro = (usd: number): number => Math.round(usd * 1_000_000);
export const toUsd = (micro: number): number => micro / 1_000_000;
/** Cents, or a tenth of a cent when the amount has one: a research call costs US$0.001. */
export const showUsd = (micro: number): string => `US$${toUsd(micro).toFixed(micro % 10_000 === 0 ? 2 : 3)}`;
