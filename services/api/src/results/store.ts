import { randomUUID } from "node:crypto";
import { type AdResult, type PackUpload, UPLOAD_MAX_FILES, type UploadState } from "@a11-wild/shared";
import { packKey } from "../pack/store.js";
import { type Item, record, type Table } from "../store/table.js";

/** A pack's id: its batch's id, or the id of a carried pack. */
const pk = packKey;
const COUNT = "UPLOADS";

/** The results of a pack: the files its client sent, and the numbers typed in from them. */
export class ResultStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Keeps a place for one more file. Nothing when the pack has its fill: the count is taken in one step, so two senders cannot pass it together. */
  async addUpload(batchId: string, file: Omit<PackUpload, "id" | "key" | "at">, keyOf: (id: string) => string): Promise<PackUpload | undefined> {
    if (!(await this.table.add(pk(batchId), COUNT, "files", 1, { ceiling: UPLOAD_MAX_FILES }))) return undefined;
    const id = randomUUID();
    const upload: PackUpload = { ...file, id, key: keyOf(id), at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: `UPLOAD#${upload.at}#${id}`, ...upload });
    return upload;
  }

  /** Keeps what the studio found when it read the file. */
  async settle(packId: string, upload: PackUpload, state: UploadState): Promise<PackUpload> {
    const settled = { ...upload, state };
    await this.table.put({ pk: pk(packId), sk: `UPLOAD#${upload.at}#${upload.id}`, ...settled });
    return settled;
  }

  async uploads(batchId: string): Promise<PackUpload[]> {
    const items = await this.table.query<Item & PackUpload>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("UPLOAD#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .map((item) => record<PackUpload>(item));
  }

  async save(batchId: string, result: Omit<AdResult, "id" | "at">): Promise<AdResult> {
    const saved: AdResult = { ...result, id: randomUUID(), at: this.now().toISOString() };
    await this.table.put({ pk: pk(batchId), sk: `RESULT#${saved.at}#${saved.id}`, ...saved });
    return saved;
  }

  async results(batchId: string): Promise<AdResult[]> {
    const items = await this.table.query<Item & AdResult>(pk(batchId));
    return items
      .filter((item) => item.sk.startsWith("RESULT#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .map((item) => record<AdResult>(item));
  }
}
