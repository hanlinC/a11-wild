import type { OutreachCandidate, OutreachCandidates, ProspectPage } from "@a11-wild/shared";
import { type FormEvent, useState } from "react";
import { FIELD } from "@/components/canon-card";
import { Failure, TAP, useWrite } from "@/components/outreach";
import { Card } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** What the section says first: what is asked of the owner now, or who acts next. */
function lead({ choosing, picked, wordsAsked, agentOwes }: OutreachCandidates): string {
  if (choosing === "closed") return "This brand takes no ad now, so nothing is picked.";
  if (wordsAsked) return `Waits for the agent: it sets the other words you asked for ("${wordsAsked.ownerSaid}"). The drafts come back for your pick after that.`;
  if (picked && agentOwes) return "You picked. Waits for the agent: it makes the full-size version of your pick, and the message is then ready. You can still pick another.";
  if (picked) return "Your pick is under Ads. Pick another draft here if you want a different ad for the next message.";
  return "Every draft the studio made for this brand. Pick the one to send: the agent then makes it full size. Nothing is sent by a pick.";
}

/**
 * Every draft the studio made for a brand, by idea, for the owner's own pick.
 * A draft that failed a check is shown greyed with what is wrong, and cannot be picked. A pick sends nothing.
 */
export function Candidates({ id, brand, candidates, done }: { id: string; brand: string; candidates: OutreachCandidates; done: (page: ProspectPage) => void }) {
  const { write, busy, error } = useWrite(id, done);
  const [words, setWords] = useState<string>();
  const [none, setNone] = useState(false);
  const [said, setSaid] = useState("");
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
        <input value={said} onChange={(event) => setSaid(event.target.value)} className={`${FIELD} text-foreground`} required maxLength={500} />
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

  const draftCard = (draft: OutreachCandidate) => {
    const mine = candidates.picked?.imageId === draft.imageId;
    return (
      <li key={draft.imageId} className="grid content-start gap-2">
        <a href={draft.viewUrl} target="_blank" rel="noopener noreferrer" title="Open large">
          <img
            src={draft.viewUrl}
            alt={`Draft ${draft.number} of "${draft.headline ?? draft.title}" for ${brand}`}
            className={`aspect-[4/5] w-full rounded-lg border bg-muted object-cover ${mine ? "border-foreground ring-2 ring-foreground" : "border-border"} ${draft.blocked ? "opacity-40 grayscale" : ""}`}
          />
        </a>
        <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          Draft {draft.number}
          {mine ? <Badge color="green">Your pick</Badge> : null}
        </p>
        {draft.blocked ? (
          <p className="text-caption text-muted-foreground">Cannot be sent: {draft.blocked}</p>
        ) : open ? (
          <div className="grid gap-2">
            {mine && candidates.agentOwes ? null : (
              <Button type="button" className={TAP} loading={busy === "pick"} onClick={() => write({ action: "pick", body: { imageId: draft.imageId } })}>
                Pick this one
              </Button>
            )}
            {candidates.words ? (
              <Button
                type="button"
                variant="ghost"
                className={TAP}
                onClick={() => {
                  setNone(false);
                  setSaid("");
                  setWords(draft.imageId);
                }}
              >
                Other words
              </Button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  const asked = words === undefined ? undefined : candidates.drafts.find((draft) => draft.imageId === words);

  return (
    <div className="grid gap-4">
      <p className="text-body" role="status">
        {lead(candidates)}
      </p>
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
    </div>
  );
}
