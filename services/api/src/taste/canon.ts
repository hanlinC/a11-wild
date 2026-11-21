import type { CanonVersion } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

const PK = "CANON";
const versionKey = (version: number) => `V#${String(version).padStart(6, "0")}`;
export const CANON_MAX_CHARS = 20_000;

/**
 * The owner's taste in plain words. Every save makes a new version with its reason and its
 * author, and no version is ever changed or removed.
 */
export class CanonStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  private async latest(): Promise<number> {
    const counter = await this.table.get(PK, "COUNT");
    let version = typeof counter?.count === "number" ? counter.count : 0;
    // The count is raised after the version is written. A save that stopped between the two left it behind, so read past it.
    while (await this.table.get(PK, versionKey(version + 1))) version += 1;
    return version;
  }

  /** The current canon. Version 0 with no text means the owner has not written one yet. */
  async get(): Promise<CanonVersion> {
    const version = await this.latest();
    const item = version > 0 ? await this.table.get<Item & CanonVersion>(PK, versionKey(version)) : undefined;
    return item ? record<CanonVersion>(item) : { version: 0, text: "", reason: "", savedBy: "", savedAt: "" };
  }

  async save(input: { text: string; reason: string; by: string }): Promise<CanonVersion> {
    const text = input.text.trim();
    const reason = input.reason.trim();
    if (!reason) throw new Refusal("A canon save needs a reason: one line on what changed and why.");
    if (!text) throw new Refusal("The canon cannot be empty.");
    if (text.length > CANON_MAX_CHARS) throw new Refusal(`The canon is longer than ${CANON_MAX_CHARS} characters. Cut it: a short canon gets read.`);
    // Two saves at the same moment each take their own number: a version is written only where none is yet.
    let version = (await this.latest()) + 1;
    const saved = (): CanonVersion => ({ version, text, reason, savedBy: input.by, savedAt: this.now().toISOString() });
    while (!(await this.table.put({ pk: PK, sk: versionKey(version), ...saved() }, { ifNotExists: true }))) version += 1;
    await this.table.add(PK, "COUNT", "count", 1);
    return saved();
  }

  async version(version: number): Promise<CanonVersion> {
    const item = await this.table.get<Item & CanonVersion>(PK, versionKey(version));
    if (!item) throw new Refusal(`There is no canon version ${version}.`);
    return record<CanonVersion>(item);
  }

  /** Every version, newest first, without the text. */
  async versions(): Promise<Omit<CanonVersion, "text">[]> {
    const items = await this.table.query<Item & CanonVersion>(PK);
    return items
      .filter((item) => item.sk.startsWith("V#"))
      .map((item) => {
        const { text: _text, ...rest } = record<CanonVersion>(item);
        return rest;
      })
      .sort((a, b) => b.version - a.version);
  }
}
