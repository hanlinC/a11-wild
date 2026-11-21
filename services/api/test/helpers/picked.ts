import type { BatchKind, Idea } from "@a11-wild/shared";
import { savedProduct } from "./batch.js";
import type { Studio } from "./deps.js";

const STAGES = ["tof", "mof", "bof"] as const;

/**
 * A batch whose three ideas each have the owner's pick, put there through the stores:
 * the steps before it have their own tests. The words on the pictures are approved.
 */
export async function pickedBatch(studio: Studio, kind: BatchKind = "v2", create: { test?: true } = {}, of?: Awaited<ReturnType<typeof savedProduct>>) {
  const { brand, product } = of ?? (await savedProduct(studio));
  const made = await studio.services.batches.create({ kind, brandId: brand.id, productId: product.id, format: "static_4x5", createdBy: "owner@example.com", ...create });
  const batch = { ...made, state: "finals" as const };
  await studio.table.put({ pk: "BATCH", sk: batch.id, ...batch });
  const ideas = STAGES.map((stage, index) => ({ id: `idea-${index + 1}`, title: `Idea ${index + 1}`, ...(kind === "v1" ? {} : { stage }) })) as Idea[];
  await studio.services.batches.saveIdeas(batch.id, ideas, "owner@example.com");
  for (const { id } of ideas) {
    await studio.services.picks.save(batch.id, { ideaId: id, imageId: `${id}-d1`, ownerSaid: "this one", by: "owner@example.com" });
    if (kind !== "v1") await studio.services.copy.approve(batch.id, { ideaId: id, headline: "THE SKIN IS | THE BEST PART.", subline: "Salted egg, on every piece.", ownerSaid: "yes", by: "owner@example.com" });
  }
  return { brand, product, batch, ideas };
}
