import { CHANGE_KINDS, COMMENT_MAX_CHARS, type ChangeKind, type ChangeRequest, type MetaVariant, type PackFormat, type PackView, type ShownComment, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type UploadType } from "@a11-wild/shared";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { useParams } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Loading, OutLink } from "@/components/loading";
import { Card, Section } from "@/components/page";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

const STAGES = { tof: "Top of funnel", mof: "Middle of funnel", bof: "Bottom of funnel" } as const;
const COMMENT_MAX = COMMENT_MAX_CHARS;
const ACCEPT = ".jpg,.jpeg,.png,.csv";
const BY_ENDING: Record<string, UploadType> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", csv: "text/csv" };

/** The type of a file by its ending: a browser names the type of a CSV in several ways, or not at all. */
export const typeOf = (name: string): UploadType | undefined => BY_ENDING[name.split(".").at(-1)?.toLowerCase() ?? ""];

export const CHANGE_KIND: Record<ChangeKind, string> = { words: "The words", picture: "The picture", offer: "The offer or price", other: "Something else" };
/** Where a change request stands, as the client reads it. */
export const changeStatus = (change: ChangeRequest): string =>
  change.status === "received" ? "Received" : change.status === "in_work" ? "In work" : change.status === "declined" ? "Not done" : change.version ? `Done in version ${change.version}` : "Done";
/** The address of the API for one pack behind a pack link. */
export const packDoor = (token: string): string => `/api/pack/${encodeURIComponent(token)}`;

/** The frame of a page a link opens: no sign-in, no menu, nothing of the studio but its name. */
export function LinkPage({ children }: { children: ReactNode }) {
  return (
    <div className="reading min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-5">
          <span className="text-title font-semibold tracking-tight">a11 studio</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-10">{children}</main>
    </div>
  );
}

/** A client's pack: the ads, the text for Meta, why each ad, the launch plan, and a place to write and to send results. No sign-in. */
export function Pack() {
  const { token = "" } = useParams();
  const load = useCallback(() => api.pack(token), [token]);
  const { value: pack, error } = useLoad(load);

  return (
    <LinkPage>
      {pack === undefined ? (
        <Loading error={error && "This link does not open a pack. Ask your contact at the studio for the current link."} />
      ) : (
        <>
          <header className="mb-8 max-w-2xl">
            <h1 className="flex flex-wrap items-baseline gap-x-3 text-display font-semibold tracking-tight">
              {pack.brand}
              {pack.example ? <span className="text-caption font-normal tracking-normal text-muted-foreground">Example</span> : null}
            </h1>
            <PackLead pack={pack} />
          </header>
          <PackBody pack={pack} door={packDoor(token)} />
        </>
      )}
    </LinkPage>
  );
}

export function PackLead({ pack }: { pack: PackView }) {
  return (
    <p className="mt-2 text-body text-muted-foreground">
      {pack.ads.length} {pack.ads.length === 1 ? "ad" : "ads"} for {pack.product}. Version {pack.version}, {when(pack.at)}.
    </p>
  );
}

type Shown = ShownComment & { at?: string };

/**
 * One pack as a link shows it. The ads come first. An example shows example comments and takes nothing:
 * it has no box to write in and no place to send a file, and the server refuses both whatever a page sends.
 */
export function PackBody({ pack, door }: { pack: PackView; door: string }) {
  const [added, setAdded] = useState<Shown[]>([]);
  const example = pack.example;
  const comments: Shown[] = example ? example.comments : [...(pack.comments ?? []), ...added];
  const add = (comment: Shown) => setAdded((all) => [...all, comment]);
  // A request stays with its ad when the ad changes. One whose ad left the pack is still shown, below the ads, so its status is never lost.
  const earlier = comments.filter((comment) => comment.change && !pack.ads.some((ad) => ad.adName === comment.adName));

  return (
    <>
      {pack.ads.map((ad, index) => (
        <Section key={ad.adName} title={ad.stage ? STAGES[ad.stage] : "Ad"}>
          <Card className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <figure>
              <a href={ad.viewUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                <img src={ad.viewUrl} alt={`The ad ${ad.adName}`} referrerPolicy="no-referrer" className="aspect-[4/5] w-full rounded-lg bg-(--tint) object-cover" />
              </a>
              <Downloads door={door} ad={index} adName={ad.adName} formats={ad.formats} />
            </figure>
            <div className="min-w-0 space-y-5">
              <Copyable label="Ad name" text={ad.adName} mono />
              <p className="text-body">{ad.why}</p>
              {ad.meta.variants.map((variant, variantIndex) => (
                <MetaText key={variantIndex === 0 ? "a" : "b"} name={variantIndex === 0 ? "Text A" : "Text B"} variant={variant} />
              ))}
              {ad.claims.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-caption font-medium text-muted-foreground">Fact check</h3>
                  <ul className="space-y-2 text-caption">
                    {ad.claims.map((claim) => (
                      <li key={claim.claim}>
                        {claim.claim}
                        <span className="text-muted-foreground"> · "{claim.quote}" · </span>
                        <span className="whitespace-nowrap">
                          <OutLink href={claim.url}>source</OutLink>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Changes requests={comments.filter((comment) => comment.adName === ad.adName && comment.change)} example={example !== undefined} />
              {example ? null : <AskForChange door={door} adName={ad.adName} onSent={add} />}
            </div>
          </Card>
        </Section>
      ))}
      {example ? <p className="mt-4 text-caption text-muted-foreground">{example.note}</p> : null}
      <Section title="Launch plan">
        <Card>
          <ol className="list-decimal space-y-1 pl-5 text-body">
            {pack.launchPlan.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      </Section>
      {earlier.length > 0 ? (
        <Section title="Earlier change requests">
          <Card>
            <Changes requests={earlier} example={false} earlier />
          </Card>
        </Section>
      ) : null}
      <Section title={example ? "Example comments" : "Comments"}>
        <Comments comments={comments.filter((comment) => !comment.change)} {...(example ? {} : { door, onSent: add })} />
      </Section>
      {example ? null : (
        <Section title="Send your results">
          <Results door={door} />
        </Section>
      )}
    </>
  );
}

/** One button for each format the ad comes in. The address is asked for at the click, so a page left open for a day still downloads. */
function Downloads({ door, ad, adName, formats }: { door: string; ad: number; adName: string; formats: PackFormat[] }) {
  const [failed, setFailed] = useState(false);
  async function download(format: PackFormat) {
    setFailed(false);
    try {
      window.location.assign(await api.packDownload(door, ad, format));
    } catch {
      setFailed(true);
    }
  }
  return (
    <figcaption className="mt-3 flex flex-wrap items-center gap-2">
      {formats.map((format) => (
        <Button key={format} variant="secondary" size="compact" onClick={() => void download(format)} aria-label={`Download ${adName} as ${format.toUpperCase()}`}>
          Download {format.toUpperCase()}
        </Button>
      ))}
      {failed ? <span className="text-caption text-muted-foreground">The download did not start. Try again in a moment.</span> : null}
    </figcaption>
  );
}

/** The change requests on one ad, each with where it stands. */
function Changes({ requests, example, earlier = false }: { requests: Shown[]; example: boolean; earlier?: boolean }) {
  if (requests.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-caption font-medium text-muted-foreground">{earlier ? "On ads this pack no longer holds" : example ? "Example change request" : "Change requests"}</h3>
      <ul className="space-y-2">
        {requests.map((request, index) => (
          <li key={`${request.at ?? "example"}-${index}`} className="rounded-lg border border-border p-3 text-caption">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">{request.change ? CHANGE_KIND[request.change.what] : null}</span>
              <span className="text-muted-foreground">{request.change ? changeStatus(request.change) : null}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-body">{request.text}</p>
            {earlier && request.adName ? <p className="mt-1 break-all font-mono text-muted-foreground">{request.adName}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskForChange({ door, adName, onSent }: { door: string; adName: string; onSent: (comment: Shown) => void }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState<ChangeKind>("words");
  const [text, setText] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  if (!open) {
    return (
      <Button variant="secondary" size="compact" onClick={() => setOpen(true)}>
        Ask for a change
      </Button>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    try {
      onSent(await api.packComment(door, { text, adName, change: what }));
      setText("");
      setOpen(false);
      setState({ busy: false });
    } catch (cause) {
      setState({ busy: false, error: describeError(cause) });
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border border-border p-4">
      <label className="block text-caption text-muted-foreground">
        What should change
        <select value={what} onChange={(event) => setWhat(event.target.value as ChangeKind)} className={`${FIELD} mt-1 text-foreground`}>
          {CHANGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CHANGE_KIND[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption text-muted-foreground">
        The change, in one or two sentences
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={COMMENT_MAX} required className={`${FIELD} mt-1 text-foreground`} />
      </label>
      {state.error ? (
        <Banner status="error">
          <BannerTitle>{state.error}</BannerTitle>
        </Banner>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="compact" disabled={state.busy || text.trim() === ""}>
          Send the request
        </Button>
        <Button type="button" variant="secondary" size="compact" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The comments on the pack. With no door it only shows them: that is the example. */
function Comments({ comments, door, onSent }: { comments: Shown[]; door?: string; onSent?: (comment: Shown) => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!door || !onSent) return;
    setState({ busy: true });
    try {
      onSent(await api.packComment(door, { text }));
      setText("");
      setState({ busy: false });
    } catch (cause) {
      setState({ busy: false, error: describeError(cause) });
    }
  }
  return (
    <Card>
      {comments.length === 0 ? (
        <p className="text-caption text-muted-foreground">No comment yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment, index) => (
            <li key={`${comment.at ?? "example"}-${index}`}>
              <p className="whitespace-pre-wrap break-words text-body">{comment.text}</p>
              <p className="text-caption text-muted-foreground">{[comment.adName ? `On ${comment.adName}` : "On the pack", comment.at ? when(comment.at) : undefined].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
      {door ? (
        <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3">
          <label className="block text-caption text-muted-foreground">
            Write a comment to the studio
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={COMMENT_MAX} required className={`${FIELD} mt-1 text-foreground`} />
          </label>
          {state.error ? (
            <Banner status="error">
              <BannerTitle>{state.error}</BannerTitle>
            </Banner>
          ) : null}
          <Button type="submit" size="compact" disabled={state.busy || text.trim() === ""}>
            Send the comment
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function MetaText({ name, variant }: { name: string; variant: MetaVariant }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-caption font-medium text-muted-foreground">{name}</h3>
      <div className="space-y-3">
        <Copyable label="Primary text" text={variant.primary} />
        <Copyable label="Headline" text={variant.headline} />
        <Copyable label="Description" text={variant.description} />
        <p className="text-caption text-muted-foreground">Button: {variant.cta}</p>
      </div>
    </div>
  );
}

/** A line of text the client pastes into Ads Manager, with a button that copies it exactly. */
function Copyable({ label, text, mono = false }: { label: string; text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div>
      {/* The button sits beside the label, so the text below keeps the full width on a phone. */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-caption text-muted-foreground">{label}</div>
        <Button variant="secondary" size="compact" onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className={mono ? "mt-1 break-all font-mono text-caption" : "mt-1 whitespace-pre-wrap text-body"}>{text}</div>
    </div>
  );
}

type Sent = { name: string; state: "sending" | "sent" | "failed"; message?: string };

function Results({ door }: { door: string }) {
  const [files, setFiles] = useState<Sent[]>([]);

  async function send(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      const set = (entry: Sent) => setFiles((all) => [...all.filter((other) => other.name !== file.name), entry]);
      const type = typeOf(file.name);
      if (!type || !Object.hasOwn(UPLOAD_TYPES, type)) {
        set({ name: file.name, state: "failed", message: "Send a JPEG or PNG screenshot, or a CSV export." });
        continue;
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        set({ name: file.name, state: "failed", message: "A file can be up to 10 MB." });
        continue;
      }
      set({ name: file.name, state: "sending" });
      try {
        await api.sendResult(door, file, type);
        set({ name: file.name, state: "sent" });
      } catch (cause) {
        set({ name: file.name, state: "failed", message: describeError(cause) });
      }
    }
  }

  return (
    <Card>
      <p className="text-body">
        After the ads have run, send a screenshot of Ads Manager or its export. Show the ad names, impressions, clicks and CTR, and the dates.
      </p>
      <p className="mt-1 text-caption text-muted-foreground">JPEG, PNG or CSV, up to 10 MB each. Export the table from Ads Manager as CSV, not as Excel.</p>
      <label className="mt-4 inline-block">
        <span className="sr-only">Choose results files</span>
        <input type="file" multiple accept={ACCEPT} onChange={(event) => { void send(event.target.files); event.target.value = ""; }} className="text-body file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-card file:px-4 file:text-body" />
      </label>
      {files.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {files.map((file) => (
            <li key={file.name}>
              <Banner status={file.state === "failed" ? "error" : file.state === "sent" ? "success" : "default"}>
                <BannerTitle>
                  {file.name}: {file.state === "sending" ? "sending" : file.state === "sent" ? "sent, thank you" : file.message}
                </BannerTitle>
              </Banner>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
