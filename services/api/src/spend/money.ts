/** Money is held as whole millionths of a US dollar, so sums never drift. */
export const toMicro = (usd: number): number => Math.round(usd * 1_000_000);
export const toUsd = (micro: number): number => micro / 1_000_000;
export const showUsd = (micro: number): string => `US$${toUsd(micro).toFixed(2)}`;
