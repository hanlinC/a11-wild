import { RULES_VERSION } from "../../src/houserules.js";
import { readTaste, sheet } from "./batch.js";
import { callTool, type Studio } from "./deps.js";

export const rules = { rulesVersion: RULES_VERSION };
export const PACK = { key: "products/p/pack.jpg", sourceUrl: "https://cdn.wongi.example/pack.jpg", kind: "pack" as const };
export const FOOD = { key: "products/p/food.jpg", sourceUrl: "https://cdn.wongi.example/food.jpg", kind: "food" as const };
const STAGES = ["tof", "mof", "bof"] as const;

/** A brief with four insights: two from buyers' words, one read from them, one guess. */
export const brief = (extra: object = {}) => ({
  insights: [
    { text: "The pack is empty before anyone else gets one.", basis: "evidence", sourceUrl: "https://forum.example/thread/1", quote: "I opened it in the car and it was gone before I got home." },
    { text: "People hide the last pack from their family.", basis: "evidence", sourceUrl: "https://forum.example/thread/2", quote: "I keep one behind the rice so my brother cannot find it." },
    { text: "It is bought as a gift and eaten by the giver.", basis: "interpretation" },
    { text: "Office workers eat it at their desk at four.", basis: "hypothesis" },
  ],
  conventions: ["A pack on a plain colour with a price."],
  openings: ["No one shows the empty pack."],
  constraints: ["No health claim."],
  unknowns: ["How many packs a buyer takes in one order."],
  ...extra,
});

/** One concept. Number n stands in territory `n % territories`, on the insight of that territory. */
export const concept = (n: number, extra: object = {}, territories = 3) => ({
  title: `Concept ${n}`,
  territory: `Territory ${(n % territories) + 1}`,
  insightId: `insight-${(n % territories) + 1}`,
  proposition: "You will not share it.",
  device: "The empty pack as a full stop",
  mechanism: { type: "product state", how: "The empty pack ends the sentence the headline starts." },
  visual: "One empty pouch lies flat on a yellow seamless, one hard shadow to its right.",
  focalPoint: "The empty pouch",
  elements: ["pouch", "shadow"],
  productRole: "The empty pouch is the proof.",
  brandRole: "The yellow word mark on black, and the brand's yellow as the stage.",
  stage: STAGES[n % 3],
  headline: `Gone again ${String.fromCharCode(64 + n)}`,
  subline: "It never reaches home.",
  sublineBasis: { kind: "second_beat" },
  claims: [],
  shows: ["pack-1"],
  pictureAlone: "Someone finished the pack.",
  headlineAlone: "Something keeps running out.",
  killTest: { passed: true, note: "Real pack, no claim." },
  risks: [],
  ...extra,
});

export const concepts = (count = 6, extra: (n: number) => object = () => ({}), territories = 3) => Array.from({ length: count }, (_, index) => concept(index + 1, extra(index + 1), territories));

/** A v3 batch at `truth`, with a pack photo and a food photo, and the owner's taste read. */
export async function v3AtTruth(studio: Studio, create: object = {}) {
  const brand = await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: { key: "brands/b/logo.png", sourceUrl: "https://wongi.example/logo.png" }, palette: [], fonts: ["Archivo"], savedBy: "owner@example.com" });
  const product = await studio.services.brands.saveProduct({ brandId: brand.id, name: "Seaweed crisps", url: "https://wongi.example/products/seaweed-crisps", photos: [PACK, FOOD], savedBy: "owner@example.com" });
  const made = await callTool(studio, "batch_create", { kind: "v3", brandId: brand.id, productId: product.id, ...create });
  const batchId = made.value.batch.id as string;
  await callTool(studio, "truth_save", { batchId, ...sheet });
  await readTaste(studio, batchId);
  await callTool(studio, "references_get", { batchId });
  return { batchId, brand, product };
}

/** A v3 batch with its brief and its first set of concepts saved. */
export async function v3AtConcepts(studio: Studio, create: object = {}) {
  const made = await v3AtTruth(studio, create);
  await callTool(studio, "brief_save", { ...rules, batchId: made.batchId, ...brief() });
  const saved = await callTool(studio, "concepts_save", { ...rules, batchId: made.batchId, concepts: concepts() });
  if (!saved.ok) throw new Error(saved.error);
  return made;
}

const SCENE = "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.";

/** Makes one rough of a concept and reads it until it is done. Returns its picture id. */
export async function roughOf(studio: Studio, batchId: string, ideaId: string): Promise<string> {
  studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind: "rough", prompt: SCENE, references: ["pack-1"] });
  if (!sent.ok) throw new Error(sent.error);
  return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id as string;
}

/** One concept's review, as a fresh critic gives it. */
export const review = (ideaId: string, extra: object = {}) => ({
  ideaId,
  scores: { originality: 4, appropriateness: 4, insight: 4, headline: 4, visual: 4, product: 4, brand: 4, commercial: 4, execution: 4 },
  pointTest: { passed: true, note: "The headline points at the empty pouch." },
  localTruth: { passed: true, note: "People here finish a pack in the car." },
  coverTest: { passed: true, note: "The empty pouch alone says it is gone." },
  wouldPay: true,
  recommend: false,
  note: "The empty pouch reads at once on the yellow stage.",
  ...extra,
});

/** A fresh critic reviews every concept of the packet, and recommends the ones named. */
export async function reviewConcepts(studio: Studio, batchId: string, recommend: string[] = []) {
  const packet = await callTool(studio, "critic_open", { batchId, step: "concepts", freshHelper: true });
  if (!packet.ok) return packet;
  const reviews = packet.value.concepts.map((entry: { id: string }) => review(entry.id, { recommend: recommend.includes(entry.id) }));
  return callTool(studio, "concept_review_save", { ...rules, batchId, ticket: packet.value.ticket, reviews });
}

export const PICKED = ["idea-2", "idea-4", "idea-5"];

/** A v3 batch whose three concepts the owner picked, and whose words he approved. */
export async function v3AtWorded(studio: Studio, create: object = {}) {
  const made = await v3AtConcepts(studio, create);
  for (const ideaId of PICKED) await roughOf(studio, made.batchId, ideaId);
  await reviewConcepts(studio, made.batchId, PICKED);
  const picked = await callTool(studio, "concept_pick", { ...rules, batchId: made.batchId, picks: PICKED.map((ideaId) => ({ ideaId, ownerSaid: `yes, ${ideaId} stops me` })) });
  if (!picked.ok) throw new Error(picked.error);
  const ideas = (await callTool(studio, "batch_get", { batchId: made.batchId })).value.ideas as { id: string; headline: string; subline: string }[];
  const worded = await callTool(studio, "copy_approve", { ...rules, batchId: made.batchId, ideas: ideas.map((idea) => ({ ideaId: idea.id, headline: idea.headline, subline: idea.subline, ownerSaid: "yes" })) });
  if (!worded.ok) throw new Error(worded.error);
  return made;
}

const AXES = {
  composition: "pouch dead centre",
  productPosition: "flat on the floor",
  scale: "pouch fills a third of the frame",
  camera: "from above",
  light: "one hard light from the left",
  environment: "yellow seamless",
  negativeSpace: "top third empty",
  staging: "one pouch alone",
};

/** One draft of a direction. Each number changes composition, camera and scale against the others. */
export const draftPlan = (n: number, axes: object = {}) => ({
  question: `Question ${n}?`,
  axes: { ...AXES, composition: `composition ${n}`, camera: `camera ${n}`, scale: `scale ${n}`, ...axes },
});

/** The direction of one picked concept. */
export const directionOf = (ideaId: string, extra: object = {}) => ({
  ideaId,
  why: "The empty pouch alone on the brand's yellow says it is gone.",
  risk: "low",
  look: "The brand's yellow as a seamless, one hard shadow.",
  lockup: "flush_left",
  drafts: [draftPlan(1), draftPlan(2), draftPlan(3)],
  ...extra,
});

/** A v3 batch with its direction saved. */
export async function v3AtDirected(studio: Studio, create: object = {}) {
  const made = await v3AtWorded(studio, create);
  const saved = await callTool(studio, "direction_save", { ...rules, batchId: made.batchId, concepts: PICKED.map((ideaId) => directionOf(ideaId)) });
  if (!saved.ok) throw new Error(saved.error);
  return made;
}
