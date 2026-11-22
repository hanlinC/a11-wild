import type { LearningRecord, ProposalView, TasteEntry } from "@a11-wild/shared";
import { useState } from "react";
import { CanonCard, FIELD } from "@/components/canon-card";
import { Loading, OutLink } from "@/components/loading";
import { Card, Empty, Fold, PageHeader, Section, Step } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useMe } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

const KIND: Record<TasteEntry["kind"], { label: string; color: "green" | "amber" | "gray" }> = {
  pick: { label: "Picked", color: "green" },
  pass: { label: "Passed", color: "amber" },
  note: { label: "Said", color: "gray" },
};
const DECIDED: Record<Exclude<ProposalView["status"], "proposed">, { label: string; color: "green" | "gray" }> = {
  approved: { label: "You said yes", color: "green" },
  declined: { label: "You said no", color: "gray" },
};
const SURE: Record<LearningRecord["confidence"], string> = { low: "Not sure yet", medium: "Fairly sure", high: "Sure" };

export function Taste() {
  const isOwner = useMe().role === "owner";
  const { value: taste, error, reload } = useLoad(api.taste);

  if (taste === undefined) {
    return (
      <>
        <Header />
        <Loading error={error} />
      </>
    );
  }
  const { canon, versions, log, swipe, canons, proposals, learning } = taste;
  const waiting = proposals.filter((proposal) => proposal.status === "proposed");
  const decided = proposals.filter((proposal) => proposal.status !== "proposed");

  return (
    <>
      <Header />

      <Step who={waiting.length > 0 && isOwner ? "you" : "nobody"}>
        {waiting.length === 0
          ? "No change to a rule waits for a yes. One shows here when an agent asks to change a canon; no rule changes before the owner says yes."
          : `${waiting.length === 1 ? "1 change to a rule waits" : `${waiting.length} changes to a rule wait`} for ${isOwner ? "your yes or no" : "the owner's yes or no"}. Nothing in it is in use until then.`}
      </Step>

      {waiting.length > 0 ? (
        <Section title={isOwner ? "Waiting for your yes" : "Waiting for the owner's yes"} count={waiting.length}>
          <ul className="grid gap-3">
            {waiting.map((proposal) => (
              <li key={proposal.id}>
                <Proposal proposal={proposal} isOwner={isOwner} reload={reload} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="What the studio works by">
        {/* Kept when closed: a canon that is being edited must not lose its text. */}
        <Fold title="Canon" note={written(canon)} keep>
          <CanonCard canon={canon} versions={versions} isOwner={isOwner} empty="No canon yet. It is your taste in plain words; every agent reads it before it writes an idea." reload={reload} />
        </Fold>
        <Fold title="Other rules" count={canons.length} note={`${canons.filter((entry) => entry.canon.version > 0).length} written`} keep>
          <p className="mb-3 max-w-2xl px-2 text-caption text-muted-foreground">
            Rules that are not your taste: what makes an ad well made, what the results of past ads showed, and what holds for one brand only. A brand's rules reach only that brand's batches.
          </p>
          <div className="grid gap-6">
          {canons.map((entry) => (
            <CanonCard
              key={`${entry.scope.kind}${entry.scope.brandId ?? ""}`}
              scope={entry.scope}
              name={entry.name}
              canon={entry.canon}
              versions={entry.versions}
              isOwner={isOwner}
              empty={entry.scope.kind === "craft" ? "Nothing yet. Rules of craft that hold for every brand go here." : entry.scope.kind === "performance" ? "Nothing yet. What the results of past ads showed goes here." : "Nothing yet for this brand."}
              reload={reload}
            />
            ))}
          </div>
        </Fold>
      </Section>

      <Section title="What it learned from">
        <Fold title="What the studio noticed" count={learning.length}>
          {learning.length === 0 ? (
            <Empty>Nothing yet. An agent writes here what it saw in a batch or in results. A note changes no rule until you say yes to a change built on it.</Empty>
          ) : (
            <ul className="grid gap-2">
              {learning.map((entry) => (
                <li key={entry.id}>
                  <Card className="py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                      <Badge variant="dot" color="gray">
                        {entry.scopeName}
                      </Badge>
                      <span>{when(entry.savedAt)}</span>
                      <span>
                        Seen {entry.evidence} {entry.evidence === 1 ? "time" : "times"} · {SURE[entry.confidence]}
                      </span>
                    </div>
                    <p className="mt-2 text-body">{entry.lesson}</p>
                    <p className="mt-1 text-caption whitespace-pre-line text-muted-foreground">
                      {entry.observation} ({entry.source})
                    </p>
                    {entry.counterexamples.length > 0 ? <p className="mt-1 text-caption text-muted-foreground">Against it: {entry.counterexamples.join("; ")}</p> : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Fold>

        {decided.length > 0 ? (
          <Fold title="Changes you decided" count={decided.length}>
            <ul className="grid gap-2">
              {decided.map((proposal) => (
                <li key={proposal.id}>
                  <Card className="py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                      <Badge variant="dot" color={DECIDED[proposal.status as "approved" | "declined"].color}>
                        {DECIDED[proposal.status as "approved" | "declined"].label}
                      </Badge>
                      <span>{proposal.scopeName}</span>
                      {proposal.decidedAt ? <span>{when(proposal.decidedAt)}</span> : null}
                      {proposal.version ? <span>Version {proposal.version}</span> : null}
                    </div>
                    <p className="mt-2 text-body">{proposal.reason}</p>
                    {proposal.ownerSaid ? <p className="mt-1 text-caption whitespace-pre-line text-muted-foreground">{proposal.ownerSaid}</p> : null}
                  </Card>
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}

        <Fold title="Taste log" count={log.length}>
          {log.length === 0 ? (
            <Empty>Nothing yet. Each draft you pick or pass, and what you say about it, is kept here in your words.</Empty>
          ) : (
            <ul className="grid gap-2">
              {log.map((entry) => (
                <li key={entry.id}>
                  <Card className="py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                      <Badge variant="dot" color={KIND[entry.kind].color}>
                        {KIND[entry.kind].label}
                      </Badge>
                      <span>{when(entry.at)}</span>
                    </div>
                    <p className="mt-2 text-body whitespace-pre-line">{entry.ownerSaid}</p>
                    {entry.about ? <p className="mt-1 text-caption whitespace-pre-line text-muted-foreground">{entry.about}</p> : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Fold>

        <Fold title="Swipe file" count={swipe.length}>
          {swipe.length === 0 ? (
            <Empty>No reference yet. Tell your agent when a piece of work is worth keeping.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {swipe.map((item) => (
                <li key={item.id}>
                  <Card className="h-full py-4">
                    <span className="text-body font-medium">{item.title}</span>
                    <p className="mt-1 text-caption text-muted-foreground">{item.why}</p>
                    <p className="mt-2 text-caption text-muted-foreground">
                      {item.sourceUrl ? <OutLink href={item.sourceUrl}>{item.source}</OutLink> : item.source}
                      {item.tags?.length ? ` · ${item.tags.join(", ")}` : ""}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Fold>
      </Section>
    </>
  );
}

/** A canon in a few words, for its closed row. */
const written = (canon: { version: number; savedAt: string }) => (canon.version === 0 ? "nothing written yet" : `version ${canon.version}, ${when(canon.savedAt)}`);

function Header() {
  return (
    <PageHeader
      title="Taste"
      lead="What the studio has learned of your taste, and the rules every agent reads before it writes an idea."
    />
  );
}

/** One change that waits: what it would make the canon say, why, and the owner's yes or no in his own words. */
function Proposal({ proposal, isOwner, reload }: { proposal: ProposalView; isOwner: boolean; reload: () => Promise<void> }) {
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState<"yes" | "no">();
  const [error, setError] = useState<string>();
  const stale = proposal.current.version !== proposal.baseVersion;

  async function decide(approve: boolean) {
    setBusy(approve ? "yes" : "no");
    setError(undefined);
    try {
      await api.decideProposal(proposal.id, approve, said);
      await reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <Badge variant="dot" color="amber">
          {proposal.scopeName}
        </Badge>
        <span>
          {when(proposal.proposedAt)} · {proposal.proposedBy}
        </span>
        <span>
          Rests on {proposal.recordIds.length} {proposal.recordIds.length === 1 ? "note" : "notes"}
        </span>
      </div>
      <p className="text-body">{proposal.reason}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-caption text-muted-foreground">{proposal.current.version === 0 ? "Now: nothing written" : `Now (version ${proposal.current.version})`}</p>
          <pre className="rounded-lg bg-(--tint) p-3 font-sans text-caption whitespace-pre-wrap">{proposal.current.text || "Nothing yet."}</pre>
        </div>
        <div>
          <p className="mb-1 text-caption text-muted-foreground">As it would read</p>
          <pre className="rounded-lg bg-(--tint) p-3 font-sans text-caption whitespace-pre-wrap">{proposal.text}</pre>
        </div>
      </div>
      {stale ? (
        <Banner status="warning">
          <BannerTitle>
            This was written against version {proposal.baseVersion}, and the canon has changed since. A yes is refused; say no, and ask your agent to write it again.
          </BannerTitle>
        </Banner>
      ) : null}
      {error ? (
        <Banner status="error">
          <BannerTitle>{error}</BannerTitle>
        </Banner>
      ) : null}
      {isOwner ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void decide(true);
          }}
        >
          <label className="grid min-w-0 flex-1 basis-64 gap-1.5 text-caption text-muted-foreground">
            In your own words, for {proposal.scopeName}
            <input value={said} onChange={(event) => setSaid(event.target.value)} className={`${FIELD} text-foreground`} required />
          </label>
          <Button type="submit" size="compact" loading={busy === "yes"} disabled={stale || busy === "no"}>
            Yes, use it
          </Button>
          <Button type="button" variant="secondary" size="compact" loading={busy === "no"} disabled={busy === "yes" || said.trim() === ""} onClick={() => void decide(false)}>
            No
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
