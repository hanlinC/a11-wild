import { z } from "zod";
import type { BatchStore } from "../../batch/store.js";
import type { PackService } from "../../pack/service.js";
import type { PackStore } from "../../pack/store.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

const id = z.string().min(1).max(64);
const content = {
  why: z
    .array(z.strictObject({ ideaId: id, why: z.string().min(1).max(400).describe("One plain sentence or two for the client: the buyer truth, what the ad does, and the source. No notes, no slang quote.") }))
    .max(3)
    .optional(),
  launchPlan: z.array(z.string().min(1).max(300)).min(1).max(8).optional().describe("One step in each line: one ad set, all the ads, 72 hours, and when to stop an ad."),
};

const ownerOnly = (role: string, what: string) => {
  if (role !== "owner") throw new Refusal(`Only the owner ${what}.`);
};

export function packTools({ batches, pack, packs }: { batches: BatchStore; pack: PackService; packs: PackStore }): ToolDefinition[] {
  return [
    defineTool({
      name: "pack_publish",
      description:
        "Makes the client pack of a done batch and its private link: the finals, the Meta text the owner approved, the ad names, one line of why for each ad, the launch plan and the fact check. The studio copies the pictures and the approved text itself; you give only the why lines and the launch plan. It refuses a batch that is not done, a test batch, a final that fails a check, and an ad with no approved Meta text. The link is returned once and the studio keeps only its hash: give it to the owner, who sends it to his client himself. Send it to no one.",
      input: { batchId: id, ...content },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, why, launchPlan }, context) => {
        ownerOnly(context.user.role, "publishes a pack");
        const made = await pack.publish(await batches.get(batchId), context.user.email, { ...(why ? { why } : {}), ...(launchPlan ? { launchPlan } : {}) });
        return { ...made, nextStep: "Give the link to the owner now: it is not shown again. A later change goes into the same link with pack_update." };
      },
    }),
    defineTool({
      name: "pack_update",
      description:
        "Puts the batch's ads as they are now into the same link, as a new version: a final that was made again, or Meta text the owner approved since. The link stays, every earlier version is kept, and pack_restore puts one back. An ad whose picture and text did not change keeps its name, so its results stay with it. Give a why line or the launch plan only to change them.",
      input: { batchId: id, ...content },
      writes: true,
      needsRules: true,
      handler: async ({ batchId, why, launchPlan }, context) => {
        ownerOnly(context.user.role, "changes a pack");
        return { version: await pack.update(await batches.get(batchId), context.user.email, { ...(why ? { why } : {}), ...(launchPlan ? { launchPlan } : {}) }) };
      },
    }),
    defineTool({
      name: "pack_restore",
      description: "Makes the link show an earlier version of the pack again. Nothing is deleted: the newer versions stay and can be shown again the same way.",
      input: { batchId: id, version: z.number().int().min(1) },
      writes: true,
      handler: async ({ batchId, version }, context) => {
        ownerOnly(context.user.role, "changes a pack");
        const { tokenHash: _tokenHash, ...shown } = await pack.restore(await batches.get(batchId), version);
        return { pack: shown };
      },
    }),
    defineTool({
      name: "pack_relink",
      description: "Gives the pack a new link, for a link that was lost or went to the wrong person. The old link opens nothing from now on, so the client needs the new one. The owner asks for this; never do it to change the ads.",
      input: { batchId: id },
      writes: true,
      handler: async ({ batchId }, context) => {
        ownerOnly(context.user.role, "replaces a pack link");
        return { ...(await pack.relink(await batches.get(batchId))), nextStep: "Give the new link to the owner now: it is not shown again." };
      },
    }),
    defineTool({
      name: "pack_get",
      description: "Returns the pack of a batch: the version its link shows and every version of its content. It does not return the link: the studio keeps only its hash.",
      input: { batchId: id },
      handler: async ({ batchId }) => {
        await batches.get(batchId);
        const found = await packs.get(batchId);
        if (!found) return { pack: null, versions: [] };
        const { tokenHash: _tokenHash, ...shown } = found;
        return { pack: shown, versions: await packs.versions(batchId) };
      },
    }),
  ];
}
