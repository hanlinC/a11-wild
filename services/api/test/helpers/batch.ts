import { RULES_VERSION } from "../../src/houserules.js";
import { callTool, type Studio } from "./deps.js";

export const PAGE = "https://wongi.example/products/seaweed-crisps";

/** A saved brand and product, as the owner's choices would leave them. */
export async function savedProduct(studio: Studio) {
  const brand = await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: null, palette: [], fonts: [], savedBy: "owner@example.com" });
  const product = await studio.services.brands.saveProduct({
    brandId: brand.id,
    name: "Seaweed crisps",
    url: PAGE,
    photos: [{ key: "products/p/food.jpg", sourceUrl: "https://cdn.wongi.example/food.jpg", kind: "food" }],
    savedBy: "owner@example.com",
  });
  return { brand, product };
}

export const idea = (n: number, extra: object = {}) => ({
  title: `Idea ${n}`,
  visual: "The pack stands alone on a wet rock, a wave about to break behind it.",
  device: "The pack as a rock in the sea",
  focalPoint: "The pack",
  elements: ["pack", "rock", "wave"],
  references: [{ what: "Lego shadow ads", does: "One object casts the shadow of what it becomes." }],
  coverTest: { passed: true, note: "Only this brand sells the sea in a pack." },
  killTest: { passed: true, note: "Real pack, real rock, no claim." },
  ...extra,
});

export const sheet = { shape: "A flat pouch with a zip top.", packaging: "Matt black pouch, yellow word mark on the front.", measures: [] };

/** Reads the owner's taste for a batch, as an agent must before it writes ideas. */
export async function readTaste(studio: Studio, batchId: string) {
  for (const tool of ["canon_get", "taste_log", "swipe_search"]) await callTool(studio, tool, { batchId });
}

/** A batch at the `truth` state with the taste read. */
export async function batchAtTruth(studio: Studio, create: object = {}) {
  const { brand, product } = await savedProduct(studio);
  const made = await callTool(studio, "batch_create", { brandId: brand.id, productId: product.id, ...create });
  const batchId = made.value.batch.id as string;
  await callTool(studio, "truth_save", { batchId, ...sheet });
  await readTaste(studio, batchId);
  return { batchId, brand, product };
}

const WHY = "It reads at once, and only this brand could run it.";

/** The blind critic keeps the batch's ideas, as a fresh helper would. */
export async function judgeIdeas(studio: Studio, batchId: string) {
  const packet = await callTool(studio, "critic_open", { batchId, step: "ideas", freshHelper: true });
  const ideas = packet.value.ideas.map((idea: { id: string }) => ({ ideaId: idea.id, verdict: "keep", reason: WHY }));
  return callTool(studio, "critic_pick", { rulesVersion: RULES_VERSION, batchId, ticket: packet.value.ticket, ideas });
}

/** The blind critic ranks every idea's drafts in the order they were sent, as a fresh helper would. */
export async function rankDrafts(studio: Studio, batchId: string) {
  const packet = await callTool(studio, "critic_open", { batchId, step: "drafts", freshHelper: true });
  if (!packet.ok) return packet;
  const ranks = packet.value.ideas.map((entry: { idea: { id: string }; drafts: { imageId: string }[] }) => ({
    ideaId: entry.idea.id,
    order: entry.drafts.map((draft) => ({ imageId: draft.imageId, reason: WHY })),
  }));
  return callTool(studio, "critic_rank", { rulesVersion: RULES_VERSION, batchId, ticket: packet.value.ticket, ranks });
}
