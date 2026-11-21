import { randomUUID } from "node:crypto";
import type { Render } from "@a11-wild/shared";
import type { FalJob } from "../fal/client.js";
import { Refusal } from "../mcp/registry.js";
import type { Reservation } from "../spend/ledger.js";
import { type Item, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (renderId: string) => `RENDER#${renderId}`;

/** A render as it is stored: what the agent sees, plus where fal keeps the job and what the ledger holds for it. */
export interface StoredRender extends Render {
  fal: FalJob;
  reservation: Reservation;
  /** How many renders its stage will have, as known when it was sent. The first one's price times this is the estimate. */
  stageCount: number;
}

export const publicRender = ({ fal: _fal, reservation: _reservation, stageCount: _stageCount, ...render }: StoredRender): Render => render;

/** The renders of a batch. Each is written when fal takes it, so a stopped session finds it again. */
export class RenderStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async create(input: Omit<StoredRender, "id" | "status" | "createdAt" | "updatedAt">): Promise<StoredRender> {
    const at = this.now().toISOString();
    const render: StoredRender = { ...input, id: randomUUID(), status: "queued", createdAt: at, updatedAt: at };
    await this.table.put({ pk: pk(render.batchId), sk: sk(render.id), ...render });
    return render;
  }

  async get(batchId: string, renderId: string): Promise<StoredRender> {
    const item = await this.table.get<Item & StoredRender>(pk(batchId), sk(renderId));
    if (!item) throw new Refusal(`This batch has no render ${renderId}. render_list gives its renders.`);
    const { pk: _pk, sk: _sk, ...render } = item;
    return render as StoredRender;
  }

  /** Oldest first: the order they were sent in. */
  async list(batchId: string): Promise<StoredRender[]> {
    const items = await this.table.query<Item & StoredRender>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("RENDER#"))
      .map(({ pk: _pk, sk: _sk, ...render }) => render as StoredRender)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /**
   * Ends a queued render, once. Two reads at the same moment can both see fal's result; the first one
   * here saves its result in the end mark and returns true, so the ledger is settled or released a single time.
   * Every write of the render takes its result from that mark, so a second read cannot replace the first one's.
   */
  async end(render: StoredRender, result: { status: "done"; imageId: string } | { status: "failed"; error: string }): Promise<boolean> {
    const mark = { pk: pk(render.batchId), sk: `ENDED#${render.id}` };
    const first = await this.table.put({ ...mark, result, updatedAt: this.now().toISOString() }, { ifNotExists: true });
    // A read that set the mark and then stopped left the render queued: this one writes its end, and leaves the ledger alone.
    if (!first && (await this.get(render.batchId, render.id)).status !== "queued") return false;
    const ended = await this.table.get<Item & { result?: typeof result; updatedAt?: string }>(mark.pk, mark.sk);
    await this.table.put({ pk: pk(render.batchId), sk: sk(render.id), ...render, ...(ended?.result ?? result), updatedAt: ended?.updatedAt ?? this.now().toISOString() });
    return first;
  }
}
