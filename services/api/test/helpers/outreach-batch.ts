import { RULES_VERSION } from "../../src/houserules.js";
import { batchAtTruth, idea, judgeIdeas } from "./batch.js";
import { callTool, type Studio } from "./deps.js";

const rules = { rulesVersion: RULES_VERSION };
const SCENE = "The pouch stands on a wet black rock at dusk, low camera, a wave about to break behind it.";

/**
 * An outreach batch for a prospect: nine checked drafts shown to the owner, his pick of the first draft of idea-1, and its checked, finished final.
 * `upTo` stops it earlier: at the checked drafts, shown to the owner, or picked by him. `done: false` leaves it before batch_done. `items` are the check items of the final.
 */
export async function outreachBatch(studio: Studio, prospectId: string, options: { done?: boolean; items?: object[]; upTo?: "checked" | "shown" | "picked" } = {}): Promise<string> {
  const { batchId } = await batchAtTruth(studio, { prospectId });
  const tick = () => {
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
  };
  const render = async (ideaId: string, kind: "draft" | "final", fromId?: string): Promise<string> => {
    tick();
    const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId, kind, prompt: SCENE, ...(fromId ? { fromId } : {}) });
    return (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
  };
  const check = (imageId: string, items: object[] = []) => callTool(studio, "checks_save", { ...rules, batchId, imageId, items });
  await callTool(studio, "ideas_save", { ...rules, batchId, ideas: [idea(1), idea(2), idea(3)] });
  await judgeIdeas(studio, batchId);
  let first: string | undefined;
  for (const ideaId of ["idea-1", "idea-2", "idea-3"]) {
    for (let n = 0; n < 3; n++) {
      const imageId = await render(ideaId, "draft");
      await check(imageId);
      if (ideaId === "idea-1") first ??= imageId;
    }
  }
  if (options.upTo === "checked") return batchId;
  await callTool(studio, "outreach_show", { batchId });
  tick();
  if (options.upTo === "shown") return batchId;
  // The owner's own pick on the prospect's page: no agent tool can make it.
  await studio.services.outreach.picks.pick(prospectId, first as string, "owner@studio.example");
  tick();
  if (options.upTo === "picked") return batchId;
  const final = await render("idea-1", "final", first);
  await check(final, options.items);
  const job = await callTool(studio, "photo_finish", { ...rules, batchId, imageId: final });
  await callTool(studio, "pixel_status", { batchId, jobId: job.value.id });
  if (options.done !== false) await callTool(studio, "batch_done", { batchId });
  tick();
  return batchId;
}
