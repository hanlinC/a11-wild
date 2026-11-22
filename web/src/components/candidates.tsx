import type { OutreachCandidate, OutreachCandidates, ProspectPage } from "@a11-wild/shared";
import { type FormEvent, useState } from "react";
import { FIELD } from "@/components/canon-card";
import { CheckNote, Failure, TAP, useWrite } from "@/components/outreach";
import { Card } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NOTE, PILL, PILL_MAIN, Viewer, ZOOM, ZoomMark } from "@/components/viewer";

/** What the section says first: what is asked of the owner now, or who acts next. */
/** What the owner can do with the drafts now. Who acts next is said once, in the step at the top of the page. */
function lead({ choosing, picked, wordsAsked, agentOwes }: OutreachCandidates): string {
  if (choosing === "closed") return "This brand takes no ad now, so nothing is picked.";
  if (wordsAsked) return `You asked for other words on one draft: "${wordsAsked.ownerSaid}"`;
  if (picked && agentOwes) return "Your pick is marked. You can still pick another.";
  if (picked) return "Your pick is under Ads. Pick another draft here if you want a different ad for the next message.";
  return "Click a draft to look at it large, or to ask for other words on it. Nothing is sent by a pick.";
}

/**
 * Every draft the studio made for a brand, by idea, for the owner's own pick.
 * No check blocks a draft: what a check found is a note beside it, and the pick is his. A click opens a draft large over the page.
 * A pick sends nothing.
 */
export function Candidates({ id, brand, candidates, done }: { id: string; brand: string; candidates: OutreachCandidates; done: (page: ProspectPage) => void }) {
  const { write, busy, error } = useWrite(id, done);
  const [words, setWords] = useState<string>();
  const [none, setNone] = useState(false);
  const [said, setSaid] = useState("");
  const [large, setLarge] = useState<number>();
  const open = candidates.choosing === "open";
  const ideas = [...new Set(candidates.drafts.map((draft) => draft.ideaId))].map((ideaId) => candidates.drafts.filter((draft) => draft.ideaId === ideaId));

  async function save(event: FormEvent, change: Parameters<typeof write>[0]) {
    event.preventDefault();
    if (await write(change)) {
      setWords(undefined);
      setNone(false);
      setSaid("");
    }
  }
  const ask = (name: string, label: string, onSubmit: (event: FormEvent) => void, onCancel: () => void) => (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label className="grid gap-1.5 text-caption text-muted-foreground">
        {label}
        {/* The form opens where he asked for it, or under the drafts he came from: the focus brings it into view. */}
        <input value={said} onChange={(event) => setSaid(event.target.value)} className={`${FIELD} text-foreground`} required maxLength={500} autoFocus />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={TAP} loading={busy === name}>
          Save
        </Button>
        <Button type="button" variant="ghost" className={TAP} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );

  const altOf = (draft: OutreachCandidate) => `Draft ${draft.number} of "${draft.headline ?? draft.title}" for ${brand}`;
  const isMine = (draft: OutreachCandidate) => candidates.picked?.imageId === draft.imageId;
  const otherWords = (draft: OutreachCandidate) => {
    setLarge(undefined);
    setNone(false);
    setSaid("");
    setWords(draft.imageId);
  };
  /** What the owner can do with one draft under its small picture: one action. Other words are asked for at the foot of the large one. */
  const actions = (draft: OutreachCandidate) =>
    draft.blocked ? (
      <p className="text-caption text-muted-foreground">Not ready to pick: {draft.blocked}</p>
    ) : open ? (
      <div className="grid gap-2">
        {isMine(draft) && candidates.agentOwes ? null : (
          <Button
            type="button"
            className={TAP}
            loading={busy === "pick"}
            onClick={async () => {
              await write({ action: "pick", body: { imageId: draft.imageId } });
            }}
          >
            Pick this one
          </Button>
        )}
      </div>
    ) : null;

  const draftCard = (draft: OutreachCandidate) => (
    <li key={draft.imageId} className="grid content-start gap-2">
      <button type="button" onClick={() => setLarge(candidates.drafts.indexOf(draft))} title="Look at it large" className={ZOOM}>
        <img src={draft.viewUrl} alt={altOf(draft)} className={`aspect-[4/5] w-full rounded-lg border bg-muted object-cover ${isMine(draft) ? "border-foreground ring-2 ring-foreground" : "border-border"}`} />
        <ZoomMark />
      </button>
      <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        Draft {draft.number}
        {isMine(draft) ? <Badge color="green">Your pick</Badge> : null}
      </p>
      {actions(draft)}
      <CheckNote warning={draft.warning} short />
    </li>
  );

  const shown = large === undefined ? undefined : candidates.drafts[large];
  const asked = words === undefined ? undefined : candidates.drafts.find((draft) => draft.imageId === words);

  return (
    <div className="grid gap-4">
      <p className="text-body text-muted-foreground">{lead(candidates)}</p>
      {ideas.map((drafts) => {
        const first = drafts[0];
        if (!first) return null;
        return (
          <Card key={first.ideaId} className="grid gap-4">
            <div>
              <h3 className="text-body font-medium">{first.headline ?? first.title}</h3>
              {first.subline ? <p className="text-body text-muted-foreground">{first.subline}</p> : null}
            </div>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">{drafts.map(draftCard)}</ul>
            {asked && asked.ideaId === first.ideaId
              ? ask(
                  "words",
                  `Draft ${asked.number} with other words: what should they say?`,
                  (event) => save(event, { action: "words", body: { imageId: asked.imageId, ownerSaid: said.trim() } }),
                  () => setWords(undefined),
                )
              : null}
          </Card>
        );
      })}
      {open && candidates.waits ? (
        none ? (
          ask(
            "none",
            "What is missing, in one line? The agent reads it for one more try. After a second no the brand is parked.",
            (event) => save(event, { action: "none", body: { ownerSaid: said.trim() } }),
            () => setNone(false),
          )
        ) : (
          <div>
            <Button
              type="button"
              variant="secondary"
              className={TAP}
              onClick={() => {
                setWords(undefined);
                setSaid("");
                setNone(true);
              }}
            >
              None of these
            </Button>
          </div>
        )
      ) : null}
      <Failure error={error} />
      {shown && large !== undefined ? (
        <Viewer shots={candidates.drafts.map((draft) => ({ url: draft.viewUrl, alt: altOf(draft) }))} at={large} onAt={setLarge} onClose={() => setLarge(undefined)}>
          {/* The whole screen is the picture: what the checks found is one line above the one button, and it is in full on the page. */}
          {shown.warning ? (
            <p className={NOTE} title={shown.warning}>
              The checks found: {shown.warning}
            </p>
          ) : null}
          {shown.blocked ? <p className={NOTE}>Not ready to pick: {shown.blocked}</p> : null}
          {error ? <p className={NOTE}>{error}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {isMine(shown) ? <span className={NOTE}>Your pick</span> : null}
            {open && !shown.blocked && !(isMine(shown) && candidates.agentOwes) ? (
              <button
                type="button"
                className={PILL_MAIN}
                disabled={busy === "pick"}
                onClick={async () => {
                  if (await write({ action: "pick", body: { imageId: shown.imageId } })) setLarge(undefined);
                }}
              >
                Pick this one
              </button>
            ) : null}
            {open && !shown.blocked && candidates.words ? (
              <button type="button" className={PILL} onClick={() => otherWords(shown)}>
                Other words
              </button>
            ) : null}
          </div>
        </Viewer>
      ) : null}
    </div>
  );
}
