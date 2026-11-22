import { type Pack, type PackUpload, TABLE_MAX_CELL, TABLE_MAX_CHARS, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type UploadTable, type UploadType } from "@a11-wild/shared";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import type { ClientActivity } from "../notify.js";
import { type Pictures, pictureType } from "../pictures/store.js";
import type { ResultStore } from "./store.js";

/** A signed upload address lives five minutes. A file that is not there after ten never comes. */
const ARRIVES_WITHIN_MS = 10 * 60 * 1000;

/** The text of a CSV, or nothing when the bytes are no plain text: a program, an archive or a spreadsheet file under a CSV's name. */
export function csvText(body: Uint8Array): string | undefined {
  if (body.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
}

/** True when the bytes are what the file was sent as. What the sender called it does not count. */
export function isSentType(type: UploadType, body: Uint8Array): boolean {
  return type === "text/csv" ? csvText(body) !== undefined && pictureType(body) === undefined : pictureType(body)?.type === type;
}

/**
 * A CSV as rows of text, cut to a size a page can hold. A cell is text and nothing else:
 * a formula in it is shown as its characters, because no spreadsheet program ever opens it.
 */
export function csvTable(text: string): UploadTable {
  const rows: string[][] = [];
  let cut = false;
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // The table holds all it may: the rest of the file is not shown.
  let full = false;
  const add = (char: string) => {
    // One more than the page shows is kept, so a cell that was cut is known as cut.
    if (cell.length <= TABLE_MAX_CELL) cell += char;
  };
  let chars = 0;
  const endCell = () => {
    if (row.length >= TABLE_MAX_COLUMNS) cut = true;
    else {
      if (cell.length > TABLE_MAX_CELL) cut = true;
      const value = cell.slice(0, TABLE_MAX_CELL);
      if (chars + value.length > TABLE_MAX_CHARS) full = true;
      else {
        chars += value.length;
        row.push(value);
      }
    }
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };
  const source = text.replace(/^\uFEFF/, "");
  for (let at = 0; at < source.length; at++) {
    const char = source[at] as string;
    if (rows.length >= TABLE_MAX_ROWS || full) {
      if (full && row.some((value) => value !== "")) rows.push(row);
      return { rows, cut: true };
    }
    if (quoted) {
      if (char === '"' && source[at + 1] === '"') {
        add('"');
        at++;
      } else if (char === '"') quoted = false;
      else add(char);
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") endCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[at + 1] === "\n") at++;
      endRow();
    } else add(char);
  }
  if (cell !== "" || row.length > 0) endRow();
  return { rows, cut: cut || full };
}

interface Deps {
  results: ResultStore;
  pictures: Pictures;
  brandOf: (packId: string) => Promise<{ id: string; name: string }>;
  notify: (activity: ClientActivity) => Promise<void>;
  now: () => Date;
}

/**
 * The files a client sent. A stranger with the link can send anything under any name, so the studio
 * reads each file itself before anyone can open it: it keeps a file that is what it was sent as, and deletes the rest.
 */
export class UploadService {
  constructor(private readonly deps: Deps) {}

  /**
   * Reads a file the studio has not read yet, and keeps what it found. A file already read is returned as it is.
   * A file that passes is copied to a place of the studio's own: the address it was sent to still takes a file
   * for some minutes, and what is sent there later must never stand in for the file the studio read.
   */
  async settle(packId: string, upload: PackUpload): Promise<PackUpload> {
    const { results, pictures, now } = this.deps;
    if (upload.state) return upload;
    // A type the studio took once and takes no more. It is not opened, and it is not deleted: deleting is the owner's word.
    if (!Object.hasOwn(UPLOAD_TYPES, upload.type)) return results.settle(packId, upload, "refused");
    const body = await pictures.read(upload.key, UPLOAD_MAX_BYTES);
    if (!body) {
      // Not there yet, or larger than what was signed, which the store does not let in. Or another reader settled it a moment ago.
      const settled = (await results.uploads(packId)).find((entry) => entry.id === upload.id);
      if (settled?.state) return settled;
      return now().getTime() - Date.parse(upload.at) > ARRIVES_WITHIN_MS ? results.settle(packId, upload, "missing") : upload;
    }
    if (!isSentType(upload.type, body)) {
      await pictures.remove(upload.key);
      log.warn("upload_refused", { type: upload.type });
      return results.settle(packId, upload, "refused");
    }
    const key = `results/packs/${packId}/${upload.id}.${UPLOAD_TYPES[upload.type]}`;
    await pictures.put(key, body, upload.type);
    // The record points to the kept copy before the sent file is removed: a save that fails leaves the sent file to be read again.
    const kept = await results.settle(packId, { ...upload, key }, "checked");
    await pictures.remove(upload.key);
    // Whoever reads the file first, the client's page or the owner's list, the owner hears of it once.
    await this.deps
      .brandOf(packId)
      .then((brand) => this.deps.notify({ brandId: brand.id, brand: brand.name, kind: "file" }))
      .catch((error: unknown) => log.error("client_activity_notice_failed", { error: error instanceof Error ? error.name : "unknown" }));
    return kept;
  }

  /** The client's page says the file is sent. The studio reads it now. */
  async done(pack: Pack, uploadId: string): Promise<{ state: "checked" | "refused" | "waiting" }> {
    const upload = (await this.deps.results.uploads(pack.id)).find((entry) => entry.id === uploadId);
    if (!upload) throw new Refusal("This pack has no such file.");
    const settled = await this.settle(pack.id, upload);
    return { state: settled.state === "checked" ? "checked" : settled.state ? "refused" : "waiting" };
  }

  /** Every file of a pack, each read by the studio first. This also reads a file whose sender never said it was sent. */
  async list(packId: string): Promise<PackUpload[]> {
    const uploads = await this.deps.results.uploads(packId);
    const settled: PackUpload[] = [];
    // One at a time: a file can be 10 MB, and the function's memory is not for twenty of them at once.
    for (const upload of uploads) settled.push(await this.settle(packId, upload));
    return settled;
  }

  /** A checked file of the pack, or a refusal: nothing else can be opened. */
  private async checked(packId: string, uploadId: string): Promise<PackUpload> {
    const upload = (await this.list(packId)).find((entry) => entry.id === uploadId);
    if (!upload) throw new Refusal("This pack has no such file.");
    if (upload.state !== "checked") throw new Refusal("The studio did not keep this file: it never arrived, or it was not what it was sent as.");
    return upload;
  }

  private async tableOf(upload: PackUpload): Promise<UploadTable> {
    const text = csvText((await this.deps.pictures.read(upload.key, UPLOAD_MAX_BYTES)) ?? new Uint8Array());
    if (text === undefined) throw new Refusal("This file is no text.");
    return csvTable(text);
  }

  /** A client's CSV as a table of text for the dashboard. */
  async table(packId: string, uploadId: string): Promise<UploadTable> {
    const upload = await this.checked(packId, uploadId);
    if (upload.type !== "text/csv") throw new Refusal("This file is a picture. Only a CSV has a table.");
    return this.tableOf(upload);
  }

  /**
   * What the owner's agent gets of a file from `list`: an address to look at a checked picture, the tool that reads a checked CSV
   * as rows of text, and nothing of any other file. A CSV is never handed out as a file, so it cannot end in a spreadsheet program,
   * and its rows come one file at a time, so many files never make one answer too large to send.
   */
  async forAgent(upload: PackUpload): Promise<{ viewUrl: string } | { rowsWith: "results_table" } | Record<string, never>> {
    if (upload.state !== "checked") return {};
    return upload.type === "text/csv" ? { rowsWith: "results_table" } : { viewUrl: await this.deps.pictures.viewUrl(upload.key) };
  }
}
