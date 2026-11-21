import { createHash } from "node:crypto";
import type { Fact } from "@a11-wild/shared";
import type { ParallelClient } from "../parallel/client.js";
import { type Item, record, type Table } from "../store/table.js";
import { isPublicHttpsUrl } from "../urlsafety.js";
import { normalise, quoteIn } from "./verify.js";

export interface FactInput {
  claim: string;
  quote: string;
  url: string;
}

export interface FactRefusal {
  claim: string;
  reason: string;
}

const key = (productId: string) => `FACTS#${productId}`;

export class FactStore {
  constructor(
    private readonly table: Table,
    private readonly parallel: ParallelClient,
    private readonly now: () => Date,
  ) {}

  /**
   * Reads each page again and keeps a fact only when its exact quote is in that page's text.
   * What the caller says the page holds is never trusted.
   */
  async save(productId: string, facts: FactInput[], by: string, batchId?: string): Promise<{ saved: Fact[]; refused: FactRefusal[] }> {
    const refused: FactRefusal[] = [];
    const checkable = facts.filter((fact) => {
      if (isPublicHttpsUrl(fact.url)) return true;
      refused.push({ claim: fact.claim, reason: "Its page is not an https address on a public host, so it was not fetched." });
      return false;
    });

    const urls = [...new Set(checkable.map((fact) => fact.url))];
    const texts = new Map<string, string>();
    if (urls.length > 0) {
      const { pages } = await this.parallel.extract({ urls, ...(batchId ? { batchId } : {}) });
      for (const page of pages) texts.set(page.url, page.text);
    }

    const saved: Fact[] = [];
    for (const fact of checkable) {
      const text = texts.get(fact.url);
      if (text === undefined) {
        refused.push({ claim: fact.claim, reason: "Its page could not be read." });
        continue;
      }
      if (!quoteIn(fact.quote, text)) {
        refused.push({ claim: fact.claim, reason: "Its quote is not in the page's text. Copy the words exactly as the page has them." });
        continue;
      }
      // The same quote from the same page is the same fact, so saving it twice keeps one.
      const id = createHash("sha256").update(`${fact.url}\n${normalise(fact.quote)}`).digest("hex").slice(0, 16);
      const record: Fact = {
        id,
        productId,
        claim: fact.claim,
        quote: fact.quote,
        url: fact.url,
        checkedAt: this.now().toISOString(),
        savedBy: by,
      };
      await this.table.put({ pk: key(productId), sk: id, ...record });
      saved.push(record);
    }
    return { saved, refused };
  }

  async list(productId: string): Promise<Fact[]> {
    const items = await this.table.query<Item & Fact>(key(productId));
    return items
      .map((item) => record<Fact>(item))
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt) || a.id.localeCompare(b.id));
  }

  async get(productId: string, factId: string): Promise<Fact | undefined> {
    const item = await this.table.get<Item & Fact>(key(productId), factId);
    return item && record<Fact>(item);
  }
}
