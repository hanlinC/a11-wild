import type { CalibrationPage } from "@a11-wild/shared";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

const PLACES = ["first", "second", "third"];

/** Does the blind critic agree with the owner? His picks beside the rank it made before he chose. */
export function Calibration() {
  const { value: page, error } = useLoad(api.calibration);

  return (
    <>
      <PageHeader
        title="Calibration"
        lead="Does the blind critic agree with you? It ranks each idea's drafts before you pick, and the board hides its order until you have chosen. This page counts how often you chose its first place."
      />
      {page === undefined ? (
        <Loading error={error} />
      ) : (
        <Section title="Your picks beside the critic's rank">
          <Picks picks={page.picks} />
        </Section>
      )}
    </>
  );
}

function Picks({ picks }: { picks: CalibrationPage["picks"] }) {
  const { firstPlace, byPlace } = picks;
  if (firstPlace.n === 0) return <Empty>No pick yet beside a rank. This fills as you pick drafts that the critic ranked first.</Empty>;
  return (
    <Card>
      <p className="text-body">
        You picked the critic's first place {firstPlace.k} of {firstPlace.n} times.
      </p>
      <p className="mt-1 text-caption text-muted-foreground">
        {Object.entries(byPlace)
          .map(([place, count]) => `Its ${PLACES[Number(place) - 1] ?? `place ${place}`}: ${count}`)
          .join(" · ")}
        {firstPlace.note ? ` · A ${firstPlace.note}.` : ""}
      </p>
    </Card>
  );
}
