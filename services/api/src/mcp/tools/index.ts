import { BatchReads } from "../../batch/reads.js";
import { BrandStore } from "../../brand/store.js";
import type { Config } from "../../config.js";
import { FactStore } from "../../facts/store.js";
import { ParallelClient } from "../../parallel/client.js";
import type { Pictures } from "../../pictures/store.js";
import type { ProviderKeys } from "../../secrets.js";
import { SpendGate } from "../../spend/gate.js";
import { SpendLedger } from "../../spend/ledger.js";
import type { Table } from "../../store/table.js";
import { CanonStore } from "../../taste/canon.js";
import { TasteLog } from "../../taste/log.js";
import { SwipeFile } from "../../taste/swipe.js";
import type { Net } from "../../urlsafety.js";
import type { ToolDefinition } from "../registry.js";
import { brandTools } from "./brand.js";
import { coreTools } from "./core.js";
import { factTools } from "./facts.js";
import { spendTools } from "./spend.js";
import { tasteTools } from "./taste.js";

export interface StudioParts {
  config: Config;
  table: Table;
  now: () => Date;
  keys: ProviderKeys;
  pictures: Pictures;
  /** How the studio fetches pages and pictures that someone else named. */
  net: Net;
  /** How the studio reaches Parallel. Tests replace it. */
  parallelFetch?: typeof fetch;
}

/** Builds the studio's services and every tool over them, the same way for the live server and for tests. */
export function studioTools(parts: StudioParts) {
  const { config, table, now, pictures, net } = parts;
  const ledger = new SpendLedger(table, now);
  const gate = new SpendGate(table, now);
  const parallel = new ParallelClient(parts.keys, ledger, parts.parallelFetch);
  const brands = new BrandStore(table, now);
  const facts = new FactStore(table, parallel, now);
  const canon = new CanonStore(table, now);
  const tasteLog = new TasteLog(table, now);
  const swipe = new SwipeFile(table, now);
  const reads = new BatchReads(table, now);
  const services = { ledger, gate, parallel, brands, facts, canon, tasteLog, swipe, reads };
  const tools: ToolDefinition[] = [
    ...coreTools(config),
    ...spendTools({ ledger, gate }),
    ...brandTools({ brands, parallel, pictures, net }),
    ...factTools({ brands, facts, parallel }),
    ...tasteTools({ canon, tasteLog, swipe, reads }),
  ];
  return { tools, services };
}
