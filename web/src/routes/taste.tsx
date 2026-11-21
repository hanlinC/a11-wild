import type { CanonVersion, TasteEntry } from "@a11-wild/shared";
import { useState } from "react";
import { Loading, OutLink } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
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
const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2";

export function Taste() {
  const isOwner = useMe().role === "owner";
  const { value: taste, error, reload } = useLoad(api.taste);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [old, setOld] = useState<CanonVersion>();

  if (taste === undefined) {
    return (
      <>
        <Header />
        <Loading error={error} />
      </>
    );
  }
  const { canon, versions, log, swipe } = taste;

  function edit() {
    setText(canon.text);
    setReason("");
    setSaveError(undefined);
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(undefined);
    try {
      await api.saveCanon(text, reason);
      await reload();
      setEditing(false);
    } catch (cause) {
      setSaveError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function show(version: number) {
    setSaveError(undefined);
    try {
      setOld(await api.canonVersion(version));
    } catch (cause) {
      setSaveError(describeError(cause));
    }
  }

  return (
    <>
      <Header />
      {saveError ? (
        <Banner status="error" className="mb-6">
          <BannerTitle>{saveError}</BannerTitle>
        </Banner>
      ) : null}

      <Section title="Canon">
        <Card>
          {editing ? (
            <form onSubmit={save} className="grid gap-4">
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                The whole canon
                <textarea value={text} onChange={(event) => setText(event.target.value)} rows={18} className={`${FIELD} font-mono text-caption text-foreground`} required />
              </label>
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                What changed, and why
                <input value={reason} onChange={(event) => setReason(event.target.value)} className={`${FIELD} text-foreground`} required />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="compact" loading={saving}>
                  Save as version {canon.version + 1}
                </Button>
                <Button type="button" variant="ghost" size="compact" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              {canon.version === 0 ? (
                <p className="text-body text-muted-foreground">No canon yet. It is your taste in plain words; every agent reads it before it writes an idea.</p>
              ) : (
                <>
                  <p className="mb-3 text-caption text-muted-foreground">
                    Version {canon.version} · {when(canon.savedAt)} · {canon.savedBy} · {canon.reason}
                  </p>
                  <pre className="font-sans text-body whitespace-pre-wrap">{canon.text}</pre>
                </>
              )}
              {isOwner ? (
                <Button variant="secondary" size="compact" className="mt-4" onClick={edit}>
                  {canon.version === 0 ? "Write the canon" : "Edit"}
                </Button>
              ) : null}
            </>
          )}
        </Card>
      </Section>

      {versions.length > 1 ? (
        <Section title="Versions" count={versions.length}>
          <ul className="grid gap-2">
            {versions.map((version) => (
              <li key={version.version}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-caption">
                  <span className="font-medium">Version {version.version}</span>
                  <span className="text-muted-foreground">
                    {when(version.savedAt)} · {version.savedBy}
                  </span>
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">{version.reason}</span>
                  <Button variant="tertiary" size="compact" onClick={() => (old?.version === version.version ? setOld(undefined) : show(version.version))}>
                    {old?.version === version.version ? "Hide" : "Read"}
                  </Button>
                  {old?.version === version.version ? <pre className="basis-full font-sans text-body whitespace-pre-wrap">{old.text}</pre> : null}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Taste log" count={log.length}>
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
      </Section>

      <Section title="Swipe file" count={swipe.length}>
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
      </Section>
    </>
  );
}

function Header() {
  return (
    <PageHeader
      title="Taste"
      lead="What the studio has learned about your taste: the canon in plain words, what you picked and passed, and the work you saved. Agents read all three before they write an idea."
    />
  );
}
