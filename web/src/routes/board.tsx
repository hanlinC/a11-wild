import type { Board as BoardData, BoardDraft, Pick } from "@a11-wild/shared";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { Loading } from "@/components/loading";
import { DoneGate } from "@/components/done-gate";
import { Card, Empty, Fold, PageHeader, Section, Step } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useAttention } from "@/lib/attention";
import { KIND_NAMES } from "@/lib/kinds";
import { useMe } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";
import { Zoom } from "@/components/viewer";

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2";
type Entry = BoardData["ideas"][number];

/** The owner's board: each idea's drafts by number, with no rank, beside what is true about the product. */
export function Board() {
  const { batchId = "" } = useParams();
  const load = useCallback(() => api.board(batchId), [batchId]);
  const { value: board, error, reload } = useLoad(load);

  if (board === undefined) {
    return (
      <>
        <PageHeader title="Pick board" lead="Each idea's drafts in the order they were made, numbered by name and not by rank." />
        <Loading error={error} />
      </>
    );
  }
  const { batch, picking, brand, product, truthSheet, ideas } = board;
  return (
    <>
      <PageHeader title={`${brand.name}: ${product.name}`} lead="Each idea's drafts in the order they were made, numbered by name and not by rank." />
      <BoardStep board={board} />
      <p className="mb-6 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
        <Badge variant="dot" color={batch.state === "done" ? "green" : "amber"}>
          {batch.state.replace("_", " ")}
        </Badge>
        <Badge color="gray">{KIND_NAMES[batch.kind]}</Badge>
        {batch.test && <Badge color="amber">Test batch: not the owner's picks</Badge>}
        <Link to={`/brands/${brand.id}`} className="underline underline-offset-2">
          Brand, facts and photos
        </Link>
        {batch.kind === "v3" ? (
          <Link to={`/batches/${batch.id}/concepts`} className="underline underline-offset-2">
            Concepts and the critic's notes
          </Link>
        ) : null}
      </p>

      <Fold title="What is true about the product">
        {truthSheet === null ? (
          <p className="px-2 text-caption text-muted-foreground">No truth sheet yet.</p>
        ) : (
          <div className="px-2">
            <p className="text-caption text-muted-foreground">Truth sheet version {truthSheet.version}</p>
            <p className="mt-2 text-body">{truthSheet.shape}</p>
            <p className="mt-1 text-body">{truthSheet.packaging}</p>
            {truthSheet.measures.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-caption">
                {truthSheet.measures.map((measure) => (
                  <li key={measure.name}>
                    {measure.name}: {measure.value} {measure.unit}
                    {measure.status === "unverified" ? <span className="ml-1.5 text-muted-foreground">unverified</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Fold>

      {ideas.length === 0 ? <Empty>No idea is saved for this batch yet.</Empty> : null}
      {ideas.map((entry, index) => (
        <IdeaSection key={entry.idea.id} batchId={batch.id} entry={entry} number={index + 1} canPick={picking === "open" && batch.purpose !== "outreach"} asked={!batch.test} onSaved={reload} />
      ))}
      {["finals", "finished", "done"].includes(batch.state) ? <DoneGate board={board} /> : null}
    </>
  );
}

/** What the board asks of its reader now, or who acts next. An outreach batch and a test batch ask nothing here. */
function BoardStep({ board: { batch, picking, ideas } }: { board: BoardData }) {
  const owner = useMe().role === "owner";
  // A yes the agent asks for in chat (a cost, the words, the Meta text) is not in the board's own state: the read of what waits has it.
  const line = useAttention().value?.batches.find((entry) => entry.batch.id === batch.id);
  if (owner && line?.who === "owner" && line.chat) return <Step who="you">{line.text} You answer your agent in chat.</Step>;
  if (picking === "closed") return <Step who="nobody">This batch is finished. Its picks are closed.</Step>;
  if (picking === "not_yet") return <Step who="agent">Not ready for your pick yet. Your agent is still making or checking the drafts.</Step>;
  if (batch.test) return <Step who="agent">A test batch: the tester chooses in your place.</Step>;
  if (batch.purpose === "outreach") {
    return (
      <Step who="nobody">
        An outreach batch: its drafts are picked on the brand's page in Outreach, not here.{" "}
        {owner && batch.prospectId ? (
          <Link to={`/outreach/prospects/${batch.prospectId}`} className="underline underline-offset-4 hover:text-foreground">
            Open the brand's page
          </Link>
        ) : null}
      </Step>
    );
  }
  const asked = ideas.filter((entry) => entry.drafts.length > 0);
  const left = asked.filter((entry) => !entry.pick).length;
  if (left === 0 && !asked.some((entry) => entry.pick?.imageId)) return <Step who="agent">You passed on every idea, so no final is made. The agent reads why you passed.</Step>;
  if (left === 0) return <Step who="agent">Every pick is made. The agent makes the finals next.</Step>;
  if (!owner) return <Step who="nobody">Waits for the owner's pick.</Step>;
  return (
    <Step who="you" left={`${left} of ${asked.length} left`}>
      Pick one draft for each idea, or pass on all of them, and say why in your own words.
    </Step>
  );
}

/** `canPick` is false where the board takes no pick (an outreach batch is picked on the brand's page); `asked` is false in a test batch, where the tester picks. */
function IdeaSection({ batchId, entry, number, canPick, asked, onSaved }: { batchId: string; entry: Entry; number: number; canPick: boolean; asked: boolean; onSaved: () => Promise<void> }) {
  const picks = useMe().role === "owner" && canPick;
  const { idea, copy, drafts, pick, rank, finals } = entry;
  const [chosen, setChosen] = useState<string | null | undefined>();
  const [said, setSaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (chosen === undefined) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.pick(batchId, { ideaId: idea.id, imageId: chosen, ownerSaid: said });
      setChosen(undefined);
      setSaid("");
      await onSaved();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title={`Idea ${number}: ${idea.title}`}
      mark={pick ? <Badge color={pick.imageId ? "green" : "gray"}>{pick.imageId ? "Picked" : "Passed"}</Badge> : picks && asked && drafts.length > 0 ? <Badge variant="dot" color="amber">Waits for your pick</Badge> : null}
    >
      <Card>
        <p className="text-body">{idea.visual}</p>
        {copy ? (
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-caption sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Headline you approved</dt>
            <dd className="font-medium">{copy.headline.replaceAll(" | ", " ")}</dd>
            <dt className="text-muted-foreground">Subline</dt>
            <dd>{copy.subline}</dd>
            {copy.footnote ? (
              <>
                <dt className="text-muted-foreground">Footnote</dt>
                <dd>{copy.footnote}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {drafts.length === 0 ? (
          <p className="mt-4 text-caption text-muted-foreground">No draft yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {drafts.map((draft) => (
              <li key={draft.image.id}>
                <Draft draft={draft} label={`Draft ${draft.number}`} alt={`${idea.title}, draft ${draft.number}`} picked={pick?.imageId === draft.image.id} />
                <CriticPlace rank={rank} imageId={draft.image.id} />
                {picks ? (
                  <Button type="button" variant={chosen === draft.image.id ? "primary" : "secondary"} size="compact" className="mt-2" onClick={() => setChosen(draft.image.id)}>
                    Pick draft {draft.number}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <PickLine pick={pick} drafts={drafts} />

        {picks && drafts.length > 0 ? (
          <form onSubmit={save} className="mt-4 grid gap-3">
            <div>
              <Button type="button" variant={chosen === null ? "primary" : "ghost"} size="compact" onClick={() => setChosen(null)}>
                Pass on all {drafts.length}
              </Button>
            </div>
            {chosen !== undefined ? (
              <>
                <label className="grid gap-1.5 text-caption text-muted-foreground">
                  {chosen === null ? "Why none of them, in your own words" : `Why draft ${drafts.find((draft) => draft.image.id === chosen)?.number}, in your own words`}
                  <input value={said} onChange={(event) => setSaid(event.target.value)} className={`${FIELD} text-foreground`} required />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" size="compact" loading={saving}>
                    {chosen === null ? "Save the pass" : "Save the pick"}
                  </Button>
                  <Button type="button" variant="ghost" size="compact" onClick={() => setChosen(undefined)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : null}
            {error ? (
              <Banner status="error">
                <BannerTitle>{error}</BannerTitle>
              </Banner>
            ) : null}
          </form>
        ) : null}

        {finals.length > 0 ? (
          <>
            <h3 className="mt-6 text-body font-medium">Finals</h3>
            <ul className="mt-3 grid gap-4 sm:grid-cols-3">
              {finals.map((final) => (
                <li key={final.image.id}>
                  <Draft draft={final} label={`Final ${final.number}`} alt={`${idea.title}, final ${final.number}`} picked={false} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </Section>
  );
}

function Draft({ draft, label, alt, picked }: { draft: BoardDraft; label: string; alt: string; picked: boolean }) {
  // A picture is shown as it is delivered: with its approved words when it has them, and a final after the real-camera finish.
  const url = draft.words?.viewUrl ?? draft.finish?.viewUrl ?? draft.viewUrl;
  // What was found in the picture, and what was found in it with its words on.
  const items = [...(draft.checks?.items ?? []), ...(draft.words?.checks?.items ?? [])];
  return (
    <figure>
      <Zoom url={url} alt={alt} className="aspect-[4/5] w-full rounded-lg bg-(--tint) object-cover" note={[label, ...items.map((item) => `${item.code}: ${item.note}`)].join(" · ")} />
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-caption">
        <span className="font-medium">{label}</span>
        {picked ? <Badge color="green">Your pick</Badge> : null}
        {draft.shown.id !== draft.image.id ? <Badge color="gray">Repaired</Badge> : null}
        {draft.finish ? <Badge color="green">Finished</Badge> : null}
        {draft.words ? <Badge color="green">Words set</Badge> : null}
        {draft.checks === null || draft.words?.checks === null ? <span className="text-muted-foreground">Not checked yet</span> : null}
      </figcaption>
      {draft.question ? <p className="mt-1 text-caption text-muted-foreground">{draft.question}</p> : null}
      {items.length > 0 ? (
        <ul className="mt-1 grid gap-1 text-caption">
          {items.map((item, index) => (
            <li key={`${item.code}-${item.tool ?? "seen"}-${index}`}>
              <Badge color={item.code.startsWith("D") ? "red" : "amber"}>{item.code}</Badge> {item.note}
              {item.tool ? <span className="ml-1 text-muted-foreground">(measured)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

const PLACES = ["first", "second", "third"];

/** Where the blind critic put this draft. The board has it only after the owner's own choice. */
function CriticPlace({ rank, imageId }: { rank: Entry["rank"]; imageId: string }) {
  const place = rank?.order.findIndex((entry) => entry.imageId === imageId) ?? -1;
  if (!rank || place < 0) return null;
  return (
    <p className="mt-1 text-caption text-muted-foreground">
      The blind critic put it {PLACES[place] ?? `at place ${place + 1}`}: {rank.order[place]?.reason}
    </p>
  );
}

function PickLine({ pick, drafts }: { pick: Pick | null; drafts: BoardDraft[] }) {
  if (!pick) return null;
  const number = drafts.find((draft) => draft.image.id === pick.imageId)?.number;
  return (
    <p className="mt-4 text-caption text-muted-foreground">
      {pick.imageId ? `You picked draft ${number}` : "You passed on all of them"} · {when(pick.at)} · “{pick.ownerSaid}”
    </p>
  );
}
