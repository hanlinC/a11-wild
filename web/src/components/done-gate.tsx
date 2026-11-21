import type { Board } from "@a11-wild/shared";
import { useCallback } from "react";
import { Loading } from "@/components/loading";
import { Card, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

/** The owner's conditions for calling a batch done, each with what the studio measured, and what only he can judge. */
export function DoneGate({ board }: { board: Board }) {
  // Read again each time the board is: a pick changes what the gate says.
  const load = useCallback(() => api.done(board.batch.id), [board]);
  const { value: report, error } = useLoad(load);

  return (
    <Section title="Done gate">
      {report === undefined ? (
        <Loading error={error} />
      ) : (
        <Card>
          <p className="text-body">
            {board.batch.test ? "This is a test batch. It is never marked done, and its ads go to no one." : report.done ? "This batch is done." : report.conditions.every((condition) => condition.passed) ? "Every condition holds. Your agent can mark the batch done." : "This batch is not done yet."}
          </p>
          <ul className="mt-4 grid gap-3">
            {report.conditions.map((condition) => (
              <li key={condition.name}>
                <p className="flex flex-wrap items-center gap-2 text-body">
                  <Badge variant="dot" color={condition.passed ? "green" : "amber"}>
                    {condition.passed ? "Met" : "Not met"}
                  </Badge>
                  {condition.asks}
                </p>
                <p className="mt-1 text-caption text-muted-foreground">{condition.evidence}</p>
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-body font-medium">Your stranger test</h3>
          <p className="mt-1 text-caption text-muted-foreground">The studio cannot measure these. You judge them.</p>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-caption">
            {report.strangerTest.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
