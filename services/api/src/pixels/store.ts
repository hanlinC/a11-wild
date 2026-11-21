import type { ImageKind, PixelJob } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const pk = (batchId: string) => `BATCH#${batchId}`;
const sk = (jobId: string) => `JOB#${jobId}`;

/** A job as the studio keeps it: what the tool was sent, and where its picture and its result go. */
export interface StoredJob extends PixelJob {
  input: Record<string, unknown>;
  resultKey: string;
  /** For a tool that makes a picture: where it goes and what it is. */
  out?: { key: string; kind: ImageKind; ideaId?: string; fromId?: string; rootId?: string };
}

export const jobView = ({ input: _input, resultKey: _resultKey, out: _out, ...job }: StoredJob): PixelJob => job;

/** The pixel jobs of a batch. */
export class JobStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  async add(job: Omit<StoredJob, "status" | "createdAt" | "updatedAt">): Promise<StoredJob> {
    const at = this.now().toISOString();
    const stored: StoredJob = { ...job, status: "queued", createdAt: at, updatedAt: at };
    await this.table.put({ pk: pk(job.batchId), sk: sk(job.id), ...stored });
    return stored;
  }

  async get(batchId: string, jobId: string): Promise<StoredJob> {
    const item = await this.table.get<Item & StoredJob>(pk(batchId), sk(jobId));
    if (!item) throw new Refusal(`This batch has no pixel job ${jobId}.`);
    return record<StoredJob>(item);
  }

  /** Ends a job. Returns nothing when another read had already ended it. */
  async end(job: StoredJob, result: Partial<Pick<StoredJob, "line" | "passed" | "madeId" | "error">> & { status: "done" | "failed" }): Promise<StoredJob | undefined> {
    const first = await this.table.put({ pk: pk(job.batchId), sk: `ENDED#${job.id}` }, { ifNotExists: true });
    // A read that set the mark and then stopped left the job queued: this one writes its end.
    if (!first && (await this.get(job.batchId, job.id)).status !== "queued") return undefined;
    const ended: StoredJob = { ...job, ...result, updatedAt: this.now().toISOString() };
    await this.table.put({ pk: pk(job.batchId), sk: sk(job.id), ...ended });
    return first ? ended : undefined;
  }
}
