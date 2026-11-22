import type { BatchLine } from "@a11-wild/shared";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { KIND_NAMES } from "@/lib/kinds";
import { when } from "@/lib/when";

/** Batches as plain rows: the name is the link, and the step says who acts next. On a brand's own page the brand is not named again. */
export function Batches({ lines, ofBrand }: { lines: BatchLine[]; ofBrand?: true }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {lines.map((line) => (
        <li key={line.batch.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
          <div className="min-w-0 flex-1 basis-64">
            <Link to={line.to} className="text-body font-medium underline underline-offset-2">
              {line.batch.label ?? "Batch"}
            </Link>
            <span className="ml-2 text-body text-muted-foreground">{ofBrand ? line.product.name : `${line.brand.name}: ${line.product.name}`}</span>
            <p className="mt-0.5 text-caption text-muted-foreground">{line.text}</p>
          </div>
          <Badge color="gray">{KIND_NAMES[line.batch.kind]}</Badge>
          <span className="text-caption text-muted-foreground">Started {when(line.batch.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
