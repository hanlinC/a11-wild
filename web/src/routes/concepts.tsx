import type { ConceptBoard, ConceptReview, ConceptScore, FunnelStage, IdeaTest } from "@a11-wild/shared";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Section, Step } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { KIND_NAMES } from "@/lib/kinds";
import { useMe } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";
import { Zoom } from "@/components/viewer";

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2";
const PICKED = 3;
type Entry = ConceptBoard["concepts"][number];

const STAGE_NAMES: Record<FunnelStage, string> = { tof: "Top of funnel", mof: "Middle of funnel", bof: "Bottom of funnel" };
const SCORE_NAMES: Record<ConceptScore, string> = {
  originality: "Original",
  appropriateness: "Right for the brand",
  insight: "Insight",
  headline: "Headline",
  visual: "Picture",
  product: "Needs the product",
  brand: "Reads as the brand",
  commercial: "Sells",
  execution: "Can be made",
};
const LEAD = "Every concept of this batch, with its rough and the critic's advice for your choice.";

/** The concept board: the owner sees every concept and the critic's review of it, and picks three himself. */
export function Concepts() {
  const { batchId = "" } = useParams();
  const load = useCallback(() => api.concepts(batchId), [batchId]);
  const { value: board, error, reload } = useLoad(load);
  const owner = useMe().role === "owner";
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();

  if (board === undefined) {
    return (
      <>
        <PageHeader title="Concepts" lead={LEAD} />
        <Loading error={error} />
      </>
    );
  }
  const { batch, brand, product, insights, picking, reviewedAt, concepts, pick } = board;
  const canPick = owner && picking === "open";
  const ids = Object.keys(chosen);
  const ready = ids.length === PICKED && ids.every((ideaId) => chosen[ideaId]?.trim());
  const territories = [...new Set(concepts.map(({ idea }) => idea.concept?.territory ?? "Concepts"))];
  const titleOf = (ideaId: string) => concepts.find(({ idea }) => idea.id === ideaId)?.idea.title ?? ideaId;

  function toggle(ideaId: string) {
    setChosen(({ [ideaId]: had, ...rest }) => (had === undefined ? { ...rest, [ideaId]: "" } : rest));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setFailure(undefined);
    try {
      await api.pickConcepts(batch.id, { picks: ids.map((ideaId) => ({ ideaId, ownerSaid: (chosen[ideaId] ?? "").trim() })) });
      setChosen({});
      await reload();
    } catch (cause) {
      setFailure(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title={`${brand.name}: ${product.name}`} lead={LEAD} />
      {picking === "not_yet" ? (
        <Step who="agent">Not ready for your pick yet. The critic has not reviewed every concept and rough as they are now.</Step>
      ) : picking === "closed" ? (
        <Step who="nobody">You approved the words of your three concepts. The pick is closed.</Step>
      ) : batch.test ? (
        <Step who="agent">A test batch: the tester chooses in your place.</Step>
      ) : !owner ? (
        <Step who="nobody">Waits for the owner.</Step>
      ) : pick ? (
        <Step who="you">Say yes or no to the words of your three concepts. You answer your agent in chat. You can still change the three here.</Step>
      ) : (
        <Step who="you" left={`${ids.length} of ${PICKED} chosen`}>
          Pick three concepts, of any stage, and say why in your own words.
        </Step>
      )}
      <p className="mb-6 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
        <Badge variant="dot" color="amber">
          {batch.state.replace("_", " ")}
        </Badge>
        <Badge color="gray">{KIND_NAMES[batch.kind]}</Badge>
        {batch.test && <Badge color="amber">Test batch: not the owner's picks</Badge>}
        {reviewedAt ? <span>The critic reviewed them {when(reviewedAt)}</span> : null}
        <Link to={`/batches/${batch.id}`} className="underline underline-offset-2">
          Pick board of the drafts
        </Link>
      </p>

      {pick ? (
        <Section title="Your pick">
          <Card>
            <ul className="grid gap-2 text-body">
              {pick.picks.map((entry) => (
                <li key={entry.ideaId}>
                  <span className="font-medium">{titleOf(entry.ideaId)}</span> <span className="text-muted-foreground">“{entry.ownerSaid}”</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-muted-foreground">Saved {when(pick.at)}</p>
            {pick.warnings.length > 0 ? (
              <ul className="mt-3 grid gap-1 text-caption">
                {pick.warnings.map((warning) => (
                  <li key={warning}>
                    <Badge color="amber">Note</Badge> {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {concepts.length === 0 ? <Empty>No concept is saved for this batch yet.</Empty> : null}
      {territories.map((territory) => {
        const own = concepts.filter(({ idea }) => (idea.concept?.territory ?? "Concepts") === territory);
        const insight = insights.find((entry) => entry.id === own[0]?.idea.concept?.insightId);
        return (
          <Section key={territory} title={territory} count={own.length}>
            {insight ? (
              <p className="mb-3 text-caption text-muted-foreground">
                Stands on: {insight.text} {insight.basis === "hypothesis" ? <Badge color="amber">A guess, no buyer said it</Badge> : null}
              </p>
            ) : null}
            <ul className="grid gap-4">
              {own.map((entry) => (
                <li key={entry.idea.id}>
                  <Concept
                    entry={entry}
                    picked={pick?.picks.some((saved) => saved.ideaId === entry.idea.id) ?? false}
                    chosen={chosen[entry.idea.id] !== undefined}
                    full={ids.length >= PICKED}
                    onToggle={canPick ? () => toggle(entry.idea.id) : undefined}
                  />
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      {canPick && ids.length > 0 ? (
        <Section title={`Your three (${ids.length} of ${PICKED})`}>
          <Card>
            <form onSubmit={save} className="grid gap-3">
              {ids.map((ideaId) => (
                <label key={ideaId} className="grid gap-1.5 text-caption text-muted-foreground">
                  Why “{titleOf(ideaId)}”, in your own words
                  <input value={chosen[ideaId]} onChange={(event) => setChosen((old) => ({ ...old, [ideaId]: event.target.value }))} className={`${FIELD} text-foreground`} required />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="compact" loading={saving} disabled={!ready}>
                  Save my three concepts
                </Button>
                <Button type="button" variant="ghost" size="compact" onClick={() => setChosen({})}>
                  Cancel
                </Button>
                {ids.length < PICKED ? <span className="text-caption text-muted-foreground">Choose {PICKED - ids.length} more.</span> : null}
              </div>
              {failure ? (
                <Banner status="error">
                  <BannerTitle>{failure}</BannerTitle>
                </Banner>
              ) : null}
            </form>
          </Card>
        </Section>
      ) : null}
    </>
  );
}

function Concept({ entry, picked, chosen, full, onToggle }: { entry: Entry; picked: boolean; chosen: boolean; full: boolean; onToggle: (() => void) | undefined }) {
  const { idea, roughs, review } = entry;
  return (
    <Card>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {roughs.length === 0 ? (
          <p className="grid aspect-[4/5] place-items-center rounded-lg bg-(--tint) p-4 text-center text-caption text-muted-foreground">No rough: judged from its words.</p>
        ) : (
          <ul className="grid content-start gap-3">
            {roughs.map((rough, index) => (
              <li key={rough.imageId}>
                <Zoom url={rough.viewUrl} alt={`${idea.title}, rough ${index + 1}`} className="aspect-[4/5] w-full rounded-lg bg-(--tint) object-cover">
                  <p className="text-body font-medium">{idea.title}</p>
                  <p className="text-caption text-muted-foreground">Rough {index + 1}</p>
                </Zoom>
              </li>
            ))}
          </ul>
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-caption">
            <span className="font-medium">{idea.title}</span>
            {idea.stage ? <Badge color="gray">{STAGE_NAMES[idea.stage]}</Badge> : null}
            {picked ? <Badge color="green">Your pick</Badge> : null}
            {review ? review.recommend ? <Badge color="green">The critic recommends it</Badge> : <Badge color="gray">Not recommended</Badge> : null}
          </p>
          <p className="mt-3 text-title font-medium text-balance">{idea.headline?.replaceAll(" | ", " ")}</p>
          <p className="mt-1 text-body">{idea.subline}</p>
          {idea.altHeadline ? <p className="mt-1 text-caption text-muted-foreground">Other headline, as an option: {idea.altHeadline.replaceAll(" | ", " ")}</p> : null}
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-caption sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Picture device</dt>
            <dd>{idea.device}</dd>
            {idea.concept ? (
              <>
                <dt className="text-muted-foreground">It says</dt>
                <dd>{idea.concept.proposition}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Picture</dt>
            <dd>{idea.visual}</dd>
          </dl>
          {review ? <Review review={review} /> : <p className="mt-4 text-caption text-muted-foreground">The critic has not reviewed it yet.</p>}
          {onToggle ? (
            <Button type="button" variant={chosen ? "primary" : "secondary"} size="compact" className="mt-4" disabled={!chosen && full} onClick={onToggle} aria-pressed={chosen}>
              {chosen ? "Chosen: take it out" : "Choose this concept"}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Review({ review }: { review: ConceptReview }) {
  const tests: [string, IdeaTest][] = [
    ["Headline points at the picture", review.pointTest],
    ["True for a buyer here", review.localTruth],
    ["Picture alone says it", review.coverTest],
  ];
  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <p className="text-caption font-medium">The critic's notes</p>
      <p className="mt-1 text-body">{review.note}</p>
      <ul className="mt-3 grid gap-1 text-caption">
        {tests.map(([name, test]) => (
          <li key={name}>
            <Badge color={test.passed ? "green" : "red"}>{test.passed ? "Yes" : "No"}</Badge> {name}: <span className="text-muted-foreground">{test.note}</span>
          </li>
        ))}
        <li>
          <Badge color={review.wouldPay ? "green" : "red"}>{review.wouldPay ? "Yes" : "No"}</Badge> Would you pay for it and be proud of it, beside your reference ads
        </li>
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        {(Object.keys(SCORE_NAMES) as ConceptScore[]).map((name) => (
          <li key={name}>
            {SCORE_NAMES[name]} <span className="font-medium text-foreground">{review.scores[name]}</span>/5
          </li>
        ))}
      </ul>
    </div>
  );
}
