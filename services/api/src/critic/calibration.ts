import type { CalibrationPage, Share } from "@a11-wild/shared";
import { teachesNothing } from "../batch/state.js";
import type { BatchStore } from "../batch/store.js";
import type { PickStore } from "../picks/store.js";
import type { CriticStore } from "./store.js";

const round = (value: number) => Math.round(value * 1000) / 1000;
const Z = 1.96;

/** A share with its Wilson 95% interval. Under 30 it is a direction, not a conclusion. */
export function share(k: number, n: number): Share {
  const small = n < 30 ? { note: "small sample: direction only, no conclusion" } : {};
  if (n === 0) return { k, n, value: null, interval: null, ...small };
  const p = k / n;
  const spread = 1 + (Z * Z) / n;
  const centre = (p + (Z * Z) / (2 * n)) / spread;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / spread;
  return { k, n, value: round(p), interval: [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))], ...small };
}

/** Whether the blind critic agrees with the owner: his picks beside the rank it made before he chose. */
export class Calibration {
  constructor(private readonly deps: { batches: BatchStore; picks: PickStore; critic: CriticStore }) {}

  async report(): Promise<CalibrationPage> {
    const { batches, picks, critic } = this.deps;
    const byPlace: Record<string, number> = {};
    let ranked = 0;
    for (const batch of await batches.list()) {
      if (teachesNothing(batch)) continue;
      const [made, ranks] = await Promise.all([picks.all(batch.id), critic.ranks(batch.id)]);
      for (const pick of made) {
        // Only his first choice counts: after it he sees the critic's order. It counts beside a rank made before it, of the same picture.
        const blind = pick.first ?? pick;
        const rank = ranks.get(pick.ideaId);
        const place = blind.imageId && rank && rank.at < blind.at ? rank.order.findIndex((entry) => entry.imageId === blind.imageId && entry.shownId === blind.shownId) + 1 : 0;
        if (place < 1) continue;
        ranked += 1;
        byPlace[place] = (byPlace[place] ?? 0) + 1;
      }
    }
    return { picks: { firstPlace: share(byPlace[1] ?? 0, ranked), byPlace } };
  }
}
