import type { CanonScope, CanonVersion } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Item, record, type Table } from "../store/table.js";

export const OWNER_TASTE: CanonScope = { kind: "owner" };
/** The owner's taste keeps the key it always had, so a canon saved before there were scopes reads as his taste. */
const pkOf = (scope: CanonScope) => (scope.kind === "owner" ? "CANON" : scope.kind === "brand" ? `CANON#BRAND#${scope.brandId}` : `CANON#${scope.kind.toUpperCase()}`);
export const scopeName = (scope: CanonScope) => (scope.kind === "owner" ? "the owner's taste" : scope.kind === "brand" ? `brand ${scope.brandId}` : `${scope.kind}`);
export const sameScope = (a: CanonScope, b: CanonScope) => a.kind === b.kind && (a.kind !== "brand" || a.brandId === b.brandId);
/** A scope as it is stored: a brand's scope names its brand, and no other scope carries one. */
export function scopeOf(input: { kind: CanonScope["kind"]; brandId?: string | undefined } | undefined): CanonScope {
  if (!input) return OWNER_TASTE;
  if (input.kind !== "brand") {
    if (input.brandId) throw new Refusal("Only the scope of a brand names a brand. Leave brandId out, or use the kind brand.");
    return input.kind === "owner" ? OWNER_TASTE : { kind: input.kind };
  }
  if (!input.brandId) throw new Refusal("The scope of a brand names the brand (brandId).");
  return { kind: "brand", brandId: input.brandId };
}
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

  private async latest(PK: string): Promise<number> {
    const counter = await this.table.get(PK, "COUNT");
    let version = typeof counter?.count === "number" ? counter.count : 0;
    // The count is raised after the version is written. A save that stopped between the two left it behind, so read past it.
    while (await this.table.get(PK, versionKey(version + 1))) version += 1;
    return version;
  }

  /** The current canon. Version 0 with no text means the owner has not written one yet. */
  async get(scope: CanonScope = OWNER_TASTE): Promise<CanonVersion> {
    const PK = pkOf(scope);
    const version = await this.latest(PK);
    const item = version > 0 ? await this.table.get<Item & CanonVersion>(PK, versionKey(version)) : undefined;
    return item ? { ...record<CanonVersion>(item), scope } : { scope, version: 0, text: "", reason: "", savedBy: "", savedAt: "" };
  }

  /** Saves the next version. With `after`, it is saved only when that version is still the newest: a change made meanwhile is not written over. */
  async save(input: { text: string; reason: string; by: string; scope?: CanonScope; after?: number }): Promise<CanonVersion> {
    const scope = input.scope ?? OWNER_TASTE;
    const PK = pkOf(scope);
    const text = input.text.trim();
    const reason = input.reason.trim();
    if (!reason) throw new Refusal("A canon save needs a reason: one line on what changed and why.");
    if (!text) throw new Refusal("The canon cannot be empty.");
    if (text.length > CANON_MAX_CHARS) throw new Refusal(`The canon is longer than ${CANON_MAX_CHARS} characters. Cut it: a short canon gets read.`);
    // Two saves at the same moment each take their own number: a version is written only where none is yet.
    let version = (await this.latest(PK)) + 1;
    const saved = (): CanonVersion => ({ scope, version, text, reason, savedBy: input.by, savedAt: this.now().toISOString() });
    const moved = () => new Refusal(`The canon of ${scopeName(scope)} changed since version ${input.after}. Read it again, and write the change on top of what it says now.`);
    if (input.after !== undefined && version !== input.after + 1) throw moved();
    while (!(await this.table.put({ pk: PK, sk: versionKey(version), ...saved() }, { ifNotExists: true }))) {
      if (input.after !== undefined) throw moved();
      version += 1;
    }
    await this.table.add(PK, "COUNT", "count", 1);
    return saved();
  }

  async version(version: number, scope: CanonScope = OWNER_TASTE): Promise<CanonVersion> {
    const item = await this.table.get<Item & CanonVersion>(pkOf(scope), versionKey(version));
    if (!item) throw new Refusal(`There is no canon version ${version} for ${scopeName(scope)}.`);
    return { ...record<CanonVersion>(item), scope };
  }

  /** Every version, newest first, without the text. */
  async versions(scope: CanonScope = OWNER_TASTE): Promise<Omit<CanonVersion, "text">[]> {
    const items = await this.table.query<Item & CanonVersion>(pkOf(scope));
    return items
      .filter((item) => item.sk.startsWith("V#"))
      .map((item) => {
        const { text: _text, ...rest } = record<CanonVersion>(item);
        return { ...rest, scope };
      })
      .sort((a, b) => b.version - a.version);
  }

  /** Brings an earlier version back as a new version. Nothing is removed: the version it replaces stays readable. */
  async restore(input: { version: number; reason: string; by: string; scope?: CanonScope }): Promise<CanonVersion> {
    const scope = input.scope ?? OWNER_TASTE;
    const earlier = await this.version(input.version, scope);
    const current = await this.get(scope);
    if (current.version === earlier.version) throw new Refusal(`Version ${earlier.version} is the current canon of ${scopeName(scope)}.`);
    return this.save({ scope, text: earlier.text, reason: `Restored version ${earlier.version}. ${input.reason.trim()}`.trim(), by: input.by });
  }
}
