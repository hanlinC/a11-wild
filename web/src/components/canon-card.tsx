import type { CanonScope, CanonVersion } from "@a11-wild/shared";
import { useState } from "react";
import { Card } from "@/components/page";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { when } from "@/lib/when";

export const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2";

interface Props {
  /** Leave it out for the owner's taste. */
  scope?: CanonScope;
  /** Said in the button names of a canon that is not the owner's taste, so that each has its own. */
  name?: string;
  canon: CanonVersion;
  versions: Omit<CanonVersion, "text">[];
  isOwner: boolean;
  /** What to say when nothing is written yet. */
  empty: string;
  reload: () => Promise<void>;
}

/** One canon: its text, the form that saves a new version, and its earlier versions, each of which the owner can bring back. */
export function CanonCard({ scope, name, canon, versions, isOwner, empty, reload }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [old, setOld] = useState<CanonVersion>();
  const [back, setBack] = useState("");
  const of = name ? ` ${name}` : "";

  function edit() {
    setText(canon.text);
    setReason("");
    setError(undefined);
    setEditing(true);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await api.saveCanon(text, reason, scope);
      await reload();
      setEditing(false);
    });
  };

  const restore = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      if (!old) return;
      await api.restoreCanon(old.version, back, scope);
      await reload();
      setOld(undefined);
      setBack("");
    });
  };

  const show = (version: number) => run(async () => setOld(await api.canonVersion(version, scope)));

  return (
    <div className="grid gap-2">
      {error ? (
        <Banner status="error">
          <BannerTitle>{error}</BannerTitle>
        </Banner>
      ) : null}
      <Card>
        {name ? <h3 className="mb-2 text-body font-medium">{name}</h3> : null}
        {editing ? (
          <form onSubmit={save} className="grid gap-4">
            <label className="grid gap-1.5 text-caption text-muted-foreground">
              {scope ? "All the rules" : "The whole canon"}
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={name ? 8 : 18} className={`${FIELD} font-mono text-caption text-foreground`} required />
            </label>
            <label className="grid gap-1.5 text-caption text-muted-foreground">
              What changed, and why
              <input value={reason} onChange={(event) => setReason(event.target.value)} className={`${FIELD} text-foreground`} required />
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="compact" loading={busy}>
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
              <p className="text-body text-muted-foreground">{empty}</p>
            ) : (
              <>
                <p className="mb-3 text-caption text-muted-foreground">
                  Version {canon.version} · {when(canon.savedAt)} · {canon.savedBy} · {canon.reason}
                </p>
                <pre className="font-sans text-body whitespace-pre-wrap">{canon.text}</pre>
              </>
            )}
            {isOwner ? (
              <Button variant="secondary" size="compact" className="mt-4" onClick={edit} aria-label={name ? `${canon.version === 0 ? "Write" : "Edit"}${of}` : undefined}>
                {canon.version === 0 ? (name ? "Write" : scope ? "Write the rules" : "Write the canon") : "Edit"}
              </Button>
            ) : null}
          </>
        )}
      </Card>

      {versions.length > 1 ? (
        <ul className="grid gap-2" aria-label={`Versions${name ? ` of ${name}` : ""}`}>
          {versions.map((version) => {
            const open = old?.version === version.version;
            return (
              <li key={version.version}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-caption">
                  <span className="font-medium">Version {version.version}</span>
                  <span className="text-muted-foreground">
                    {when(version.savedAt)} · {version.savedBy}
                  </span>
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">{version.reason}</span>
                  <Button variant="tertiary" size="compact" onClick={() => (open ? setOld(undefined) : show(version.version))}>
                    {open ? "Hide" : "Read"}
                  </Button>
                  {open ? <pre className="basis-full font-sans text-body whitespace-pre-wrap">{old.text}</pre> : null}
                  {open && isOwner && version.version !== canon.version ? (
                    <form onSubmit={restore} className="flex basis-full flex-wrap items-end gap-2">
                      <label className="grid min-w-0 flex-1 gap-1.5 text-muted-foreground">
                        Why bring version {version.version} back
                        <input value={back} onChange={(event) => setBack(event.target.value)} className={`${FIELD} text-foreground`} required />
                      </label>
                      <Button type="submit" variant="secondary" size="compact" loading={busy}>
                        Bring it back as version {canon.version + 1}
                      </Button>
                    </form>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
