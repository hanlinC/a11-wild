import { z } from "zod";
import type { Importer } from "../../import/ingest.js";
import { defineTool, Refusal, type ToolDefinition } from "../registry.js";

export function importTools({ importer }: { importer: Importer }): ToolDefinition[] {
  return [
    defineTool({
      name: "import_ingest",
      description:
        "The one-time copy of the owner's taste from a11-adgen. Owner only. Send up to 50 records a call; each has kind (canon_line, taste, swipe or brand), originId (its id in a11-adgen) and the fields of its kind in scripts/import-adgen/mapping.md. A record sent again changes nothing. A record with a field the mapping does not know is refused and named, and the others are kept. Set buildCanon true on the last call: the active canon lines become one canon version. The reply gives the counts the studio now holds.",
      input: {
        records: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
        buildCanon: z.boolean().default(false),
      },
      writes: true,
      handler: async ({ records, buildCanon }, context) => {
        if (context.user.role !== "owner") throw new Refusal("Only the owner can run the copy from a11-adgen.");
        const result = await importer.ingest(records, context.user.email);
        const canon = buildCanon ? await importer.canonFromLines(context.user.email) : undefined;
        return { ...result, ...(canon ? { canon } : {}), counts: await importer.counts() };
      },
    }),
  ];
}
