import type { ConceptBoard } from "@a11-wild/shared";
import type { BatchStore } from "../batch/store.js";
import type { BrandStore } from "../brand/store.js";
import type { BriefStore } from "../brief/store.js";
import type { CriticService } from "../critic/service.js";
import type { ImageStore } from "../images/store.js";
import type { Pictures } from "../pictures/store.js";
import type { ConceptPicks } from "./pick.js";

interface Deps {
  batches: BatchStore;
  brands: BrandStore;
  briefs: BriefStore;
  critic: CriticService;
  images: ImageStore;
  pictures: Pictures;
  conceptPicks: ConceptPicks;
}

/** What the owner sees before he picks three concepts: every concept with its roughs and the critic's review. */
export class ConceptBoardService {
  constructor(private readonly deps: Deps) {}

  async show(batchId: string): Promise<ConceptBoard> {
    const { batches, brands, briefs, critic, images, pictures, conceptPicks } = this.deps;
    const batch = await batches.get(batchId);
    const [brand, product, concepts, brief, reviews, pick, roughs] = await Promise.all([
      brands.brand(batch.brandId),
      brands.product(batch.productId),
      batches.burst(batchId),
      briefs.get(batchId),
      critic.conceptReviewsOf(batchId),
      conceptPicks.get(batchId),
      images.list(batchId, "rough"),
    ]);
    // A review of an older set says nothing of the set as it is now.
    const current = reviews?.current ? reviews : undefined;
    return {
      batch,
      brand: { id: brand.id, name: brand.name },
      product: { id: product.id, name: product.name },
      insights: brief?.insights ?? [],
      picking: batch.kind !== "v3" || !current ? "not_yet" : batch.state === "reviewed" || batch.state === "judged" ? "open" : "closed",
      reviewedAt: current?.at ?? null,
      concepts: await Promise.all(
        concepts.map(async (idea) => ({
          idea,
          roughs: await Promise.all(roughs.filter((image) => image.ideaId === idea.id).map(async (image) => ({ imageId: image.id, viewUrl: await pictures.viewUrl(image.key) }))),
          review: current?.reviews.find((entry) => entry.ideaId === idea.id) ?? null,
        })),
      ),
      pick: pick ?? null,
    };
  }
}
