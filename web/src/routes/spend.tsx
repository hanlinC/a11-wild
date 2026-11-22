import type { SpendLine } from "@a11-wild/shared";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { usd, when } from "@/lib/when";

const STATUS: Record<SpendLine["status"], { label: string; color: "green" | "amber" | "gray" }> = {
  spent: { label: "Paid", color: "green" },
  reserved: { label: "Held", color: "amber" },
  released: { label: "Not charged", color: "gray" },
};

/** How many batches the log shows before the owner asks for the older ones. */
const SHOWN = 8;

interface Group {
  batchId: string;
  campaign: boolean;
  lines: SpendLine[];
  newest: string;
  paidUsd: number;
  heldUsd: number;
}

const sum = (lines: SpendLine[], status: SpendLine["status"]) => lines.filter((line) => line.status === status).reduce((total, line) => total + line.usd, 0);

/** The lines of each batch together, the batch with the newest line first. The lines that belong to no batch are one group of their own. */
function byBatch(lines: SpendLine[]): Group[] {
  const groups = new Map<string, SpendLine[]>();
  for (const line of lines) groups.set(line.batchId ?? "", [...(groups.get(line.batchId ?? "") ?? []), line]);
  return [...groups.entries()]
    .map(([batchId, own]) => {
      const sorted = [...own].sort((a, b) => b.at.localeCompare(a.at));
      return { batchId, campaign: own.some((line) => line.campaign), lines: sorted, newest: sorted[0]?.at ?? "", paidUsd: sum(own, "spent"), heldUsd: sum(own, "reserved") };
    })
    .sort((a, b) => b.newest.localeCompare(a.newest));
}

const nameOf = (group: Group) => (group.batchId ? `${group.campaign ? "Outreach batch" : "Batch"} ${group.batchId.slice(0, 8)}` : "Outside a batch");

export function Spend() {
  const { value: spend, error } = useLoad(api.spend);

  return (
    <>
      <PageHeader
        title="Spend"
        lead="What the studio paid Parallel and fal this month, beside its caps."
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
          <p className="mt-3 text-caption text-muted-foreground">Every paid call holds its price before it is sent, and a call that would pass a cap is refused.</p>

          <Section title="Outreach campaign">
            <Card className="grid gap-6 sm:grid-cols-3">
              <Figure label="Spent on outreach ads" value={usd(spend.campaign.usd)} />
              <Figure label="Campaign cap" value={usd(spend.campaign.capUsd)} />
              <Figure label="Cap for one outreach ad" value={usd(spend.campaign.batchCapUsd)} />
            </Card>
            <p className="mt-3 text-caption text-muted-foreground">Counted apart from the month: an outreach ad never spends from the monthly cap.</p>
          </Section>

          {spend.lines.length === 0 ? (
            <Section title="This month">
              <Empty>Nothing spent this month.</Empty>
            </Section>
          ) : (
            <Log lines={spend.lines} />
          )}
        </>
      )}
    </>
  );
}

/** The log, folded: one row for each batch with its total, and the calls of a batch only when the owner opens it. */
function Log({ lines }: { lines: SpendLine[] }) {
  const groups = byBatch(lines);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, SHOWN);
  const toggle = (batchId: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(batchId)) next.add(batchId);
      return next;
    });

  return (
    <Section title="This month, by batch" count={groups.length}>
      <Card className="p-0">
        <ul>
          {shown.map((group) => {
            const isOpen = open.has(group.batchId);
            const panel = `spend-${group.batchId || "outside"}`;
            return (
              <li key={group.batchId} className="border-t border-border first:border-t-0">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    onClick={() => toggle(group.batchId)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-(--hover)"
                  >
                    <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                    {/* On a phone the name sits over its calls and time; on a wide screen they share one line. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span className="truncate text-body" title={group.batchId || undefined}>
                        {nameOf(group)}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                        <span>
                          {group.lines.length} {group.lines.length === 1 ? "call" : "calls"} · {when(group.newest)}
                        </span>
                        {group.heldUsd > 0 ? (
                          <Badge variant="dot" color="amber">
                            {usd(group.heldUsd)} held
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-body whitespace-nowrap sm:w-20">{usd(group.paidUsd)}</span>
                  </button>
                </h3>
                {isOpen ? (
                  <div id={panel} className="overflow-x-auto border-t border-border bg-(--hover)">
                    <table className="w-full text-left text-caption" aria-label={`Calls of ${nameOf(group)}`}>
                      <thead className="text-muted-foreground">
                        <tr>
                          {["When", "Service", "What", "Cost", "State"].map((head) => (
                            <th key={head} scope="col" className="px-5 py-2 font-normal">
                              {head}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.lines.map((line, index) => (
                          <tr key={`${line.at}${line.ref}${line.kind}${index}`} className="border-t border-border">
                            <td className="px-5 py-2 whitespace-nowrap">{when(line.at)}</td>
                            <td className="px-5 py-2">{line.service}</td>
                            {/* On a phone the table scrolls sideways: a reference in a column four letters wide cannot be read. */}
                            <td className="min-w-56 px-5 py-2">
                              {line.kind} <span className="break-words text-muted-foreground">{line.ref}</span>
                            </td>
                            <td className="px-5 py-2 font-mono whitespace-nowrap">{usd(line.usd)}</td>
                            <td className="px-5 py-2">
                              <Badge variant="dot" color={STATUS[line.status].color}>
                                {STATUS[line.status].label}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      {groups.length > SHOWN ? (
        <Button variant="tertiary" size="compact" className="mt-3" onClick={() => setAll((was) => !was)}>
          {all ? "Show the newest only" : `Show ${groups.length - SHOWN} older`}
        </Button>
      ) : null}
      <p className="mt-3 text-caption text-muted-foreground">The amount of a row is what was paid. Open a row for each call of that batch.</p>
    </Section>
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
