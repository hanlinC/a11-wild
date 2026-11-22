import type { SpendLine } from "@a11-wild/shared";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { usd, when } from "@/lib/when";

const STATUS: Record<SpendLine["status"], { label: string; color: "green" | "amber" | "gray" }> = {
  spent: { label: "Paid", color: "green" },
  reserved: { label: "Held", color: "amber" },
  released: { label: "Not charged", color: "gray" },
};

/** The lines of each batch together, newest batch first, then the lines that belong to no batch. */
function byBatch(lines: SpendLine[]): [string, SpendLine[]][] {
  const groups = new Map<string, SpendLine[]>();
  for (const line of lines) groups.set(line.batchId ?? "", [...(groups.get(line.batchId ?? "") ?? []), line]);
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
}

export function Spend() {
  const { value: spend, error } = useLoad(api.spend);

  return (
    <>
      <PageHeader
        title="Spend"
        lead="What the studio paid Parallel and fal this month. Every paid call holds its price before it is sent, and a call that would pass a cap is refused."
      />
      {spend === undefined ? (
        <Loading error={error} />
      ) : (
        <>
          <Card className="grid gap-6 sm:grid-cols-3">
            <Figure label={`Spent in ${spend.month}`} value={usd(spend.monthUsd)} />
            <Figure label="Monthly cap" value={usd(spend.monthCapUsd)} />
            <Figure label="Cap for one batch" value={usd(spend.batchCapUsd)} />
          </Card>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--tint)" role="progressbar" aria-label="Share of the monthly cap used" aria-valuemin={0} aria-valuemax={spend.monthCapUsd} aria-valuenow={spend.monthUsd}>
            <div className="h-full bg-foreground" style={{ width: `${Math.min(100, (spend.monthUsd / spend.monthCapUsd) * 100)}%` }} />
          </div>

          {spend.lines.length === 0 ? (
            <Section title="This month">
              <Empty>Nothing spent this month.</Empty>
            </Section>
          ) : (
            byBatch(spend.lines).map(([batchId, lines]) => (
              <Section key={batchId} title={batchId ? `Batch ${batchId}` : "Outside a batch"} count={lines.length}>
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-left text-caption">
                    <thead className="text-muted-foreground">
                      <tr>
                        {["When", "Service", "What", "Cost", "State"].map((head) => (
                          <th key={head} scope="col" className="px-5 py-3 font-normal">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={`${line.at}${line.ref}${line.kind}`} className="border-t border-border">
                          <td className="px-5 py-3 whitespace-nowrap">{when(line.at)}</td>
                          <td className="px-5 py-3">{line.service}</td>
                          {/* On a phone the table scrolls sideways: a reference in a column four letters wide cannot be read. */}
                          <td className="min-w-56 px-5 py-3">
                            {line.kind} <span className="break-words text-muted-foreground">{line.ref}</span>
                          </td>
                          <td className="px-5 py-3 font-mono whitespace-nowrap">{usd(line.usd)}</td>
                          <td className="px-5 py-3">
                            <Badge variant="dot" color={STATUS[line.status].color}>
                              {STATUS[line.status].label}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </Section>
            ))
          )}
        </>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-caption text-muted-foreground">{label}</span>
      <span className="mt-1 block text-display font-semibold tracking-tight">{value}</span>
    </div>
  );
}
