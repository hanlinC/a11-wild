import { FINAL_POINTS, type FinalPoints } from "@a11-wild/shared";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (imageId: string) => `POINTS#${imageId}`;

/** The points of a final that did not pass. */
export const failedPoints = (points: FinalPoints) => FINAL_POINTS.filter((point) => !points.points[point].passed);

/** The agent's eight-point look at a finished final of a concept ad, at full size and at phone size. */
export class PointStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async get(batchId: string, imageId: string): Promise<FinalPoints | undefined> {
    const item = await this.table.get<Item & FinalPoints>(pk(batchId), sk(imageId));
    return item && record<FinalPoints>(item);
  }

  async save(batchId: string, points: Omit<FinalPoints, "at">): Promise<FinalPoints> {
    const saved: FinalPoints = { ...points, at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: sk(points.imageId), ...saved });
    return saved;
  }
}
