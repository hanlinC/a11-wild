import { CHANGE_KINDS, COMMENT_MAX_CHARS, type ChangeKind, type ChangeRequest, type PackFormat, type PackView, type ShownComment, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type UploadType } from "@a11-wild/shared";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { useParams } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Loading, OutLink } from "@/components/loading";
import { Card, Section } from "@/components/page";
import { NOTE, PILL, Viewer, ZOOM, ZoomMark } from "@/components/viewer";
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

/** The frame of a page a link opens: no sign-in, no menu, no bar. The first thing on it is the first ad. */
export function LinkPage({ children }: { children: ReactNode }) {
  return (
    <div className="reading min-h-dvh">
      <main className="mx-auto max-w-[1000px] px-4 pt-5 pb-16">{children}</main>
    </div>
  );
}

/** The small line a link page starts with: whose it is, then what it is. */
export function TopLine({ brand, children }: { brand: string; children: ReactNode }) {
  return (
    <h1 className="mb-1 text-caption font-normal">
      <b className="font-semibold">{brand}</b> <span className="text-muted-foreground">{children}</span>
    </h1>
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
          <TopLine brand={pack.brand}>{[pack.product, `Version ${pack.version}`, pack.example ? "Example" : undefined].filter(Boolean).join(" · ")}</TopLine>
          <PackBody pack={pack} door={packDoor(token)} />
        </>
      )}
    </LinkPage>
  );
}

export function PackLead({ pack }: { pack: PackView }) {
  return (
    <p className="mt-1 text-caption text-muted-foreground">
      {pack.ads.length} {pack.ads.length === 1 ? "ad" : "ads"}. Version {pack.version}, {when(pack.at)}.
    </p>
  );
}

type Shown = ShownComment & { at?: string };

type Ad = PackView["ads"][number];
const FORMAT: Record<PackFormat, string> = { jpg: "JPEG", png: "PNG" };
/** The line an ad is known by: the words on its picture, or the headline of its text for Meta. A bar in the words is a line break, not a word. */
export const titleOf = (ad: Ad): string => (ad.words?.headline ?? ad.meta.variants[0].headline).replace(/\s*\|\s*/g, " ");
const unique = (items: string[]): string[] => [...new Set(items)];

/**
 * One pack as a link shows it: an ad is one card, its picture beside everything the client pastes into Meta, with nothing to press to read it.
 * An example shows example comments and takes nothing: it has no box to write in and no place to send a file, and the server refuses both whatever a page sends.
 * `lead` is the short welcome under the ads; a page of several packs says it once.
 */
export function PackBody({ pack, door, lead = true }: { pack: PackView; door: string; lead?: boolean }) {
  const [added, setAdded] = useState<Shown[]>([]);
  const [large, setLarge] = useState<number>();
  const { download, failed } = useDownload(door);
  const example = pack.example;
  const comments: Shown[] = example ? example.comments : [...(pack.comments ?? []), ...added];
  const add = (comment: Shown) => setAdded((all) => [...all, comment]);
  // A request stays with its ad when the ad changes. One whose ad left the pack is still shown, below the ads, so its status is never lost.
  const earlier = comments.filter((comment) => comment.change && !pack.ads.some((ad) => ad.adName === comment.adName));
  // One fact check for the pack: a claim two ads make is proved once.
  const facts = pack.ads.flatMap((ad) => ad.claims).filter((fact, index, all) => all.findIndex((other) => other.claim === fact.claim && other.quote === fact.quote && other.url === fact.url) === index);
  const shown = large === undefined ? undefined : pack.ads[large];
  const format = shown?.formats.includes("jpg") ? "jpg" : shown?.formats[0];

  return (
    <>
      {pack.ads.map((ad, index) => (
        <section key={ad.adName} aria-label={titleOf(ad)} className="my-4 grid gap-4 rounded-xl bg-card p-3 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-7 md:p-4">
          <div>
            <button type="button" onClick={() => setLarge(index)} title="Look at it large" className={`${ZOOM} overflow-hidden`}>
              <img src={ad.viewUrl} alt={`The ad ${ad.adName}`} referrerPolicy="no-referrer" loading={index === 0 ? undefined : "lazy"} className="aspect-[4/5] w-full bg-muted object-cover" />
              <ZoomMark />
            </button>
            <Downloads download={(chosen) => download(index, chosen)} failed={failed === index} adName={ad.adName} formats={ad.formats} />
          </div>
          <div className="min-w-0 text-body">
            <h2 className="text-title font-semibold">{titleOf(ad)}</h2>
            {ad.stage ? (
              <p className="mt-1">
                <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-[13px] leading-5">{STAGES[ad.stage]}</span>
              </p>
            ) : null}
            <Label hint="Paste it into Ads Manager exactly. It lets us match your results to this ad.">Ad name</Label>
            <p>
              <code className="rounded bg-muted px-1.5 py-px font-sans font-semibold break-all">{ad.adName}</code>
            </p>
            <Label hint={'Pick one. The first 125 characters show before "See more".'}>Text above the picture</Label>
            <Options items={ad.meta.variants.map((variant) => variant.primary)} />
            <Label hint="Pick one.">Headline</Label>
            <Options items={ad.meta.variants.map((variant) => variant.headline)} />
            <Label>Description and button</Label>
            <Options items={ad.meta.variants.map((variant) => variant.description)} />
            <p>Button: {unique(ad.meta.variants.map((variant) => variant.cta)).join(" or ")}</p>
            <Label>Why we made this ad</Label>
            <p>{ad.why}</p>
            {example ? null : (
              <div className="mt-5 space-y-3">
                <Changes requests={comments.filter((comment) => comment.adName === ad.adName && comment.change)} />
                <AskForChange door={door} adName={ad.adName} onSent={add} />
              </div>
            )}
          </div>
        </section>
      ))}
      {large === undefined || !shown ? null : (
        <Viewer shots={pack.ads.map((ad) => ({ url: ad.viewUrl, alt: `The ad ${ad.adName}` }))} at={large} onAt={setLarge} onClose={() => setLarge(undefined)}>
          {failed === large ? <p className={NOTE}>The download did not start. Try again in a moment.</p> : null}
          {format ? (
            <button type="button" className={PILL} onClick={() => void download(large, format)} aria-label={`Download ${shown.adName} as ${FORMAT[format]}, from the large view`}>
              Download {FORMAT[format]}
            </button>
          ) : null}
        </Viewer>
      )}
      {example ? <p className="mt-4 text-caption text-muted-foreground">{example.note}</p> : null}
      {lead && !example ? (
        <>
          <p className="mt-12 max-w-[60ch] text-title">Your ads are ready. Each one has the picture, the words to paste into Meta, and the reason we made it. Tap any picture to see it full size.</p>
          <ol className="my-2 list-decimal space-y-1 pl-6 text-body">
            <li>Download the picture.</li>
            <li>Paste the text into Meta Ads Manager.</li>
            <li>Copy the ad name exactly.</li>
            <li>Follow the launch plan below.</li>
          </ol>
        </>
      ) : null}
      <Section title="Launch plan">
        <Card>
          <ol className="list-decimal space-y-1 pl-5 text-body">
            {pack.launchPlan.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      </Section>
      {facts.length > 0 ? (
        <Section title="Fact check">
          <p className="-mt-1 mb-3 text-body text-muted-foreground">Every claim in the ads, with the sentence and the page that prove it. Nothing here is guessed.</p>
          <ul className="grid gap-2.5">
            {facts.map((fact) => (
              <li key={`${fact.claim}|${fact.quote}|${fact.url}`} className="rounded-[10px] border border-border bg-card px-3.5 py-3 [overflow-wrap:anywhere]">
                <p className="text-body font-semibold">{fact.claim}</p>
                <p className="mt-1 text-caption text-muted-foreground">"{fact.quote}"</p>
                <p className="mt-1.5 text-caption">
                  <OutLink href={fact.url}>{hostOf(fact.url)}</OutLink>
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {earlier.length > 0 ? (
        <Section title="Earlier change requests">
          <Card>
            <Changes requests={earlier} earlier />
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

/** The name of the site a fact comes from: the whole address is behind the link. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/** The name of one thing the client pastes, with a line on how to use it. */
function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <p className="mt-[18px] mb-1 font-bold">
      {children}
      {hint ? <small className="font-normal text-muted-foreground"> {hint}</small> : null}
    </p>
  );
}

/** The wordings to pick from, lettered. Two that are the same are one, and one alone has no letter. */
function Options({ items }: { items: string[] }) {
  const all = unique(items);
  return all.map((item, index) => (
    <p key={item} className="mb-1.5 whitespace-pre-wrap">
      {all.length > 1 ? <b>{String.fromCharCode(65 + index)}. </b> : null}
      {item}
    </p>
  ));
}

/** Starts a download. The address is asked for at the click, so a page left open for a day still downloads. `failed` is the ad whose download did not start. */
function useDownload(door: string) {
  const [failed, setFailed] = useState<number>();
  async function download(ad: number, format: PackFormat) {
    setFailed(undefined);
    try {
      window.location.assign(await api.packDownload(door, ad, format));
    } catch {
      setFailed(ad);
    }
  }
  return { download, failed };
}

/** One button for each format the ad comes in. */
function Downloads({ download, failed, adName, formats }: { download: (format: PackFormat) => Promise<void>; failed: boolean; adName: string; formats: PackFormat[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {formats.map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => void download(format)}
          aria-label={`Download ${adName} as ${FORMAT[format]}`}
          className="mt-2.5 rounded-lg bg-primary px-4 py-[9px] text-[14px] leading-[22px] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Download {FORMAT[format]}
        </button>
      ))}
      {failed ? <span className="mt-2.5 text-caption text-muted-foreground">The download did not start. Try again in a moment.</span> : null}
    </div>
  );
}

/** The change requests on one ad, each with where it stands. */
function Changes({ requests, earlier = false }: { requests: Shown[]; earlier?: boolean }) {
  if (requests.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-caption font-medium text-muted-foreground">{earlier ? "On ads this pack no longer holds" : "Change requests"}</h3>
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
