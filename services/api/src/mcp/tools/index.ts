import { DoneGate } from "../../batch/done.js";
import { BatchReads } from "../../batch/reads.js";
import { BatchStore } from "../../batch/store.js";
import { BoardService } from "../../board/service.js";
import { BrandStore } from "../../brand/store.js";
import { CheckStore } from "../../checks/store.js";
import type { Config } from "../../config.js";
import { Calibration } from "../../critic/calibration.js";
import { CriticService } from "../../critic/service.js";
import { CriticStore } from "../../critic/store.js";
import { FactStore } from "../../facts/store.js";
import { FalClient } from "../../fal/client.js";
import { ImageStore } from "../../images/store.js";
import { Importer } from "../../import/ingest.js";
import { ParallelClient } from "../../parallel/client.js";
import { PickStore } from "../../picks/store.js";
import type { Pictures } from "../../pictures/store.js";
import type { PixelRunner } from "../../pixels/runner.js";
import { PixelService } from "../../pixels/service.js";
import { JobStore } from "../../pixels/store.js";
import { RenderService } from "../../render/service.js";
import { RenderStore } from "../../render/store.js";
import type { ProviderKeys } from "../../secrets.js";
import { SpendGate } from "../../spend/gate.js";
import { SpendLedger } from "../../spend/ledger.js";
import type { Table } from "../../store/table.js";
import { CanonStore } from "../../taste/canon.js";
import { TasteLog } from "../../taste/log.js";
import { SwipeFile } from "../../taste/swipe.js";
import { TruthStore } from "../../truth/store.js";
import type { Net } from "../../urlsafety.js";
import type { ToolDefinition } from "../registry.js";
import { batchTools } from "./batch.js";
import { boardTools } from "./board.js";
import { brandTools } from "./brand.js";
import { coreTools } from "./core.js";
import { criticTools } from "./critic.js";
import { factTools } from "./facts.js";
import { importTools } from "./import.js";
import { pixelTools } from "./pixels.js";
import { renderTools } from "./render.js";
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
  /** How the studio reaches fal. Tests replace it. */
  falFetch?: typeof fetch;
  /** How the studio starts a pixel job. Missing where the pixel function is not deployed. */
  pixelRunner?: PixelRunner;
}

/** Builds the studio's services and every tool over them, the same way for the live server and for tests. */
export function studioTools(parts: StudioParts) {
  const { config, table, now, pictures, net } = parts;
  const ledger = new SpendLedger(table, now);
  const gate = new SpendGate(table, now);
  const parallel = new ParallelClient(parts.keys, ledger, parts.parallelFetch, gate);
  const brands = new BrandStore(table, now);
  const facts = new FactStore(table, parallel, now);
  const canon = new CanonStore(table, now);
  const tasteLog = new TasteLog(table, now);
  const swipe = new SwipeFile(table, now);
  const reads = new BatchReads(table, now);
  const importer = new Importer({ table, canon, tasteLog, swipe, brands, pictures, net, now });
  const batches = new BatchStore(table, now);
  const truth = new TruthStore(table, facts, now);
  const images = new ImageStore(table, now);
  const renders = new RenderStore(table, now);
  const fal = new FalClient(parts.keys, parts.falFetch);
  const checks = new CheckStore(table, now);
  const picks = new PickStore(table, now);
  const criticStore = new CriticStore(table, now);
  const board = new BoardService({ batches, brands, truth, images, renders, checks, picks, critic: criticStore, tasteLog, pictures });
  const calibration = new Calibration({ batches, picks, critic: criticStore });
  const critic = new CriticService({ batches, brands, truth, facts, board, critic: criticStore });
  const done = new DoneGate({ batches, brands, facts, truth, board });
  const render = new RenderService({ batches, brands, images, renders, ledger, gate, fal, pictures, finals: board });
  const jobs = new JobStore(table, now);
  const pixels = new PixelService({ batches, brands, images, checks, board, jobs, pictures, runner: parts.pixelRunner, now });
  const services = { ledger, gate, parallel, brands, facts, canon, tasteLog, swipe, reads, importer, batches, truth, images, renders, render, checks, picks, board, jobs, pixels, calibration, critic, done };
  const tools: ToolDefinition[] = [
    ...coreTools(config),
    ...spendTools({ ledger, gate }),
    ...brandTools({ brands, parallel, pictures, net }),
    ...factTools({ brands, facts, parallel }),
    ...tasteTools({ canon, tasteLog, swipe, reads }),
    ...importTools({ importer }),
    ...batchTools({ batches, brands, facts, truth, reads, critic: criticStore, done }),
    ...criticTools({ critic, calibration }),
    ...renderTools({ render }),
    ...pixelTools({ pixels }),
    ...boardTools({ board }),
  ];
  return { tools, services };
}

/** The studio's stores, as the tools and the dashboard routes share them. */
export type StudioServices = ReturnType<typeof studioTools>["services"];
