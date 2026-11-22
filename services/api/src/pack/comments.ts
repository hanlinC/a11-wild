import { randomUUID } from "node:crypto";
import {
  CHANGE_KINDS,
  CHANGE_STATUSES,
  type ChangeKind,
  type ChangeStatus,
  COMMENT_MAX_CHARS,
  COMMENTS_MAX,
  type Pack,
  type PackComment,
  type PackVersion,
  type ShownComment,
} from "@a11-wild/shared";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import type { ClientActivity } from "../notify.js";
import { type Item, record, type Table } from "../store/table.js";
import { packKey } from "./store.js";

const COUNT = "COMMENTS";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Every control character but the line feed. A comment is plain text: a page shows it as text and never as markup.
const CONTROL = /(?!\n)[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/** A comment's text, made plain: no control character, no stray space at its ends. */
export function plainText(value: unknown): string {
  if (typeof value !== "string") throw new Refusal("A comment is text.");
  const text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
  if (!text || text.length > COMMENT_MAX_CHARS) throw new Refusal(`A comment has 1 to ${COMMENT_MAX_CHARS} characters.`);
  return text;
}

/** The comments of each pack, change requests among them. */
export class CommentStore {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
  ) {}

  /** Saves one more comment. Nothing when the pack has its fill: the count is taken in one step, so two senders cannot pass it together. */
  async add(packId: string, comment: ShownComment): Promise<PackComment | undefined> {
    if (!(await this.table.add(packKey(packId), COUNT, "comments", 1, { ceiling: COMMENTS_MAX }))) return undefined;
    const saved: PackComment = { ...comment, id: randomUUID(), at: this.now().toISOString() };
    await this.table.put({ pk: packKey(packId), sk: `COMMENT#${saved.at}#${saved.id}`, ...saved });
    return saved;
  }

  private async items(packId: string): Promise<(Item & PackComment)[]> {
    const items = await this.table.query<Item & PackComment>(packKey(packId));
    return items.filter((item) => item.sk.startsWith("COMMENT#")).sort((a, b) => a.sk.localeCompare(b.sk));
  }

  /** Every comment of the pack, oldest first, hidden ones too. */
  async all(packId: string): Promise<PackComment[]> {
    return (await this.items(packId)).map((item) => record<PackComment>(item));
  }

  /** What the client's page shows of a pack: its comments without the hidden ones, and without their ids. */
  async shown(packId: string): Promise<(ShownComment & { at: string })[]> {
    return (await this.all(packId)).filter((comment) => !comment.hidden).map(shown);
  }

  /** Changes one comment, or gives nothing when the pack has no such comment. */
  async change(packId: string, id: string, to: (comment: PackComment) => PackComment): Promise<PackComment | undefined> {
    const item = ID.test(id) ? (await this.items(packId)).find((entry) => entry.id === id) : undefined;
    if (!item) return undefined;
    const next = to(record<PackComment>(item));
    await this.table.put({ pk: item.pk, sk: item.sk, ...next });
    return next;
  }
}

interface Deps {
  comments: CommentStore;
  /** The brand of a pack: its id for the owner's page, its name for the notice. */
  brandOf: (pack: Pack) => Promise<{ id: string; name: string }>;
  notify: (activity: ClientActivity) => Promise<void>;
}

/** What a client sends on the page: a comment on the pack or on one ad, or a request to change one ad. */
export interface CommentInput {
  text: unknown;
  adName?: unknown;
  change?: unknown;
}

/** The client's comments and change requests, and what the owner does with them. */
export class CommentService {
  constructor(private readonly deps: Deps) {}

  /** Takes a comment through a link that opened this pack. An example takes nothing, whatever the page that asks looks like. */
  async send(pack: Pack, version: PackVersion, input: CommentInput): Promise<ShownComment & { at: string }> {
    if (pack.example) throw new Refusal("This page is an example. It takes no comment.");
    const text = plainText(input.text);
    const { adName, change } = input;
    if (adName !== undefined && !version.ads.some((ad) => ad.adName === adName)) throw new Refusal("This pack has no such ad.");
    if (change !== undefined && !CHANGE_KINDS.includes(change as ChangeKind)) throw new Refusal(`A change is one of: ${CHANGE_KINDS.join(", ")}.`);
    if (change !== undefined && adName === undefined) throw new Refusal("A change request names the ad to change.");
    const saved = await this.deps.comments.add(pack.id, {
      text,
      ...(adName !== undefined ? { adName: adName as string } : {}),
      ...(change !== undefined ? { change: { what: change as ChangeKind, status: "received" as const } } : {}),
    });
    if (!saved) throw new Refusal(`This pack holds ${COMMENTS_MAX} comments, which is its fill. Write to the studio directly.`);
    // The comment is saved. A notice that fails must not turn it into an error for the client: the dashboard shows it all the same.
    await this.deps
      .brandOf(pack)
      .then((brand) => this.deps.notify({ brandId: brand.id, brand: brand.name, kind: saved.change ? "change" : "comment" }))
      .catch((error: unknown) => log.error("client_activity_notice_failed", { error: error instanceof Error ? error.name : "unknown" }));
    return shown(saved);
  }

  /** Every comment of a pack for the owner, oldest first. */
  all(packId: string): Promise<PackComment[]> {
    return this.deps.comments.all(packId);
  }

  /** The owner hides a comment from the client's page, or shows it again. */
  async hide(packId: string, id: string, hidden: boolean): Promise<PackComment> {
    const next = await this.deps.comments.change(packId, id, ({ hidden: _hidden, ...comment }) => ({ ...comment, ...(hidden ? { hidden: true } : {}) }));
    if (!next) throw new Refusal("This pack has no such comment.");
    return next;
  }

  /** The owner says where a change request stands. "done" keeps the pack's version of that moment: the one that holds the change. */
  async setStatus(pack: Pack, id: string, status: unknown): Promise<PackComment> {
    if (!CHANGE_STATUSES.includes(status as ChangeStatus)) throw new Refusal(`A status is one of: ${CHANGE_STATUSES.join(", ")}.`);
    let request = true;
    const next = await this.deps.comments.change(pack.id, id, (comment) => {
      if (!comment.change) {
        request = false;
        return comment;
      }
      return { ...comment, change: { what: comment.change.what, status: status as ChangeStatus, ...(status === "done" ? { version: pack.current } : {}) } };
    });
    if (!next) throw new Refusal("This pack has no such comment.");
    if (!request) throw new Refusal("This comment is no change request. Only a change request has a status.");
    return next;
  }
}

/**
 * A changed ad gets a new name, and a comment keeps the name its ad had when it was written. This gives each comment
 * the name its ad has now, so a change request stays with its ad in every version. An ad the pack no longer holds keeps its old name.
 */
export function onCurrentAds<T extends { adName?: string }>(comments: T[], versions: PackVersion[], current: PackVersion): T[] {
  const now = new Set(current.ads.map((ad) => ad.adName));
  const ideaOf = new Map(versions.flatMap((version) => version.ads).map((ad) => [ad.adName, ad.ideaId]));
  return comments.map((comment) => {
    if (comment.adName === undefined || now.has(comment.adName)) return comment;
    const idea = ideaOf.get(comment.adName);
    const ad = idea === undefined ? undefined : current.ads.find((entry) => entry.ideaId === idea);
    return ad ? { ...comment, adName: ad.adName } : comment;
  });
}

const shown = ({ id: _id, hidden: _hidden, ...comment }: PackComment): ShownComment & { at: string } => comment;

/** Checks a comment the studio wrote for an example: the same shape a client's page shows. */
export function exampleComment(comment: ShownComment, adNames: string[]): ShownComment {
  let text: string;
  try {
    text = plainText(comment.text);
  } catch {
    throw new Refusal(`An example comment has 1 to ${COMMENT_MAX_CHARS} characters.`);
  }
  if (comment.adName !== undefined && !adNames.includes(comment.adName)) throw new Refusal(`An example comment names the ad "${String(comment.adName).slice(0, 80)}", which is not in this pack.`);
  const { change } = comment;
  if (change !== undefined) {
    if (comment.adName === undefined) throw new Refusal("An example change request names the ad to change.");
    if (!CHANGE_KINDS.includes(change.what) || !CHANGE_STATUSES.includes(change.status)) throw new Refusal("An example change request has a kind and a status the page knows.");
    if (change.version !== undefined && (change.status !== "done" || !Number.isInteger(change.version) || change.version < 1)) throw new Refusal("Only a done example change request names a version.");
  }
  return {
    text,
    ...(comment.adName !== undefined ? { adName: comment.adName } : {}),
    ...(change ? { change: { what: change.what, status: change.status, ...(change.version !== undefined ? { version: change.version } : {}) } } : {}),
  };
}
