import { CHANGE_STATUSES, type ChangeStatus, type OwnerClient, type OwnerClientPack, type PackComment, type UploadTable } from "@a11-wild/shared";
import { useCallback, useState } from "react";
import { Loading, OutLink } from "@/components/loading";
import { Card, Empty, Fold, PageHeader, Section, Step } from "@/components/page";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";
import { CHANGE_KIND, changeStatus } from "./pack";

const STATUS_BUTTON: Record<ChangeStatus, string> = { received: "Received", in_work: "In work", done: "Done", declined: "Not done" };
const UPLOAD_STATE = { arriving: "still arriving", refused: "deleted: it was not the type it was sent as", missing: "never arrived" } as const;
const isOpen = (comment: PackComment) => comment.change !== undefined && (comment.change.status === "received" || comment.change.status === "in_work");

/**
 * The owner's page of clients: the change requests that wait come first, then each client with the link, the comments and the files.
 * Everything a client wrote is shown as text. A client's file opens only after the studio read it; a CSV is shown as a table of text.
 */
export function Clients() {
  const load = useCallback(() => api.portal(), []);
  const { value: loaded, error } = useLoad(load);
  const [changed, setChanged] = useState<Record<string, PackComment>>({});
  const [failure, setFailure] = useState<string>();

  if (loaded === undefined) return <Loading error={error && describeError(error)} />;
  const clients: OwnerClient[] = loaded.map((client) => ({ ...client, packs: client.packs.map((pack) => ({ ...pack, comments: pack.comments.map((comment) => changed[comment.id] ?? comment) })) }));
  const waiting = clients.flatMap((client) => client.packs.flatMap((pack) => pack.comments.filter(isOpen).map((comment) => ({ client, pack, comment }))));

  async function mark(packId: string, id: string, to: { hidden: boolean } | { status: ChangeStatus }) {
    setFailure(undefined);
    try {
      const comment = await api.markComment(packId, id, to);
      setChanged((all) => ({ ...all, [comment.id]: comment }));
    } catch (cause) {
      setFailure(describeError(cause));
    }
  }

  return (
    <>
      <PageHeader title="Clients" lead="What your clients asked for, wrote and sent through their private links. You answer them by WhatsApp or email; a status here is what they see on their page." />
      {failure ? (
        <Banner status="error">
          <BannerTitle>{failure}</BannerTitle>
        </Banner>
      ) : null}
      <Step who={waiting.length > 0 ? "you" : "nobody"}>
        {waiting.length > 0
          ? `${waiting.length === 1 ? "1 change request waits" : `${waiting.length} change requests wait`} for you. Set each to In work, Done or Not done: your client sees that status on their page.`
          : "No change request waits for you. One shows here when a client asks for a change on their page."}
      </Step>
      {waiting.length > 0 ? (
        <Section title="Change requests that wait" count={waiting.length}>
          <ul className="space-y-3">
            {waiting.map(({ client, pack, comment }) => (
              <li key={comment.id}>
                <Request brand={client.brand.name} pack={pack} comment={comment} onStatus={(status) => void mark(pack.packId, comment.id, { status })} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Clients" count={clients.length}>
        {clients.length === 0 ? (
          <Empty>A brand appears here when it has a pack or a client link.</Empty>
        ) : (
          clients.map((client) => (
            // Kept when closed: a new link is shown once, and closing the row must not lose it.
            <Fold key={client.brand.id} title={client.brand.name} note={noteOf(client)} keep>
              <div className="space-y-6 px-2 py-1">
                <Link client={client} />
                {client.packs.length === 0 ? <p className="text-caption text-muted-foreground">No finished pack yet. The client's page is empty until there is one.</p> : null}
                {client.packs.map((pack) => (
                  <div key={pack.packId} className="border-t border-border pt-5">
                    <h3 className="text-body font-medium">
                      {pack.product} <span className="text-caption font-normal text-muted-foreground">version {pack.version}, {when(pack.at)}{pack.example ? " · example: it is on no client's page, and takes no comment and no file" : ""}</span>
                    </h3>
                    {pack.example ? null : (
                      <>
                        <CommentList pack={pack} onMark={(id, to) => void mark(pack.packId, id, to)} />
                        <Files pack={pack} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </Fold>
          ))
        )}
      </Section>
    </>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A client in a few words: what waits first, then what its packs hold. The link is not named here: its state can change inside the row. */
function noteOf(client: OwnerClient): string {
  const comments = client.packs.flatMap((pack) => pack.comments);
  const waits = comments.filter(isOpen).length;
  const files = client.packs.reduce((sum, pack) => sum + pack.uploads.length, 0);
  return [
    waits > 0 ? count(waits, "request waits", "requests wait") : undefined,
    count(client.packs.length, "pack", "packs"),
    comments.length > 0 ? count(comments.length, "comment", "comments") : undefined,
    files > 0 ? count(files, "file", "files") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Request({ brand, pack, comment, onStatus }: { brand: string; pack: OwnerClientPack; comment: PackComment; onStatus: (status: ChangeStatus) => void }) {
  const picture = pack.ads.find((ad) => ad.adName === comment.adName)?.viewUrl;
  return (
    <Card className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
      {picture ? <img src={picture} alt={`The ad ${comment.adName}`} className="aspect-[4/5] w-24 rounded-lg bg-(--tint) object-cover" /> : <div />}
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground">
          {brand} · {pack.product} · <span className="break-all font-mono">{comment.adName}</span> · {when(comment.at)}
        </p>
        <p className="mt-1 text-body font-medium">
          {comment.change ? CHANGE_KIND[comment.change.what] : null} <span className="font-normal text-muted-foreground">· {comment.change ? changeStatus(comment.change) : null}</span>
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-body">{comment.text}</p>
        <StatusButtons comment={comment} onStatus={onStatus} />
      </div>
    </Card>
  );
}

function StatusButtons({ comment, onStatus }: { comment: PackComment; onStatus: (status: ChangeStatus) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {CHANGE_STATUSES.filter((status) => status !== comment.change?.status).map((status) => (
        <Button key={status} variant="secondary" size="compact" onClick={() => onStatus(status)} aria-label={`Set to ${STATUS_BUTTON[status]}: ${comment.text.slice(0, 60)}`}>
          {STATUS_BUTTON[status]}
        </Button>
      ))}
    </div>
  );
}

/** The client's link: whether it is on, and the buttons that make, replace or close it. A new link is shown once. */
function Link({ client }: { client: OwnerClient }) {
  const [state, setState] = useState(client.link?.state);
  const [url, setUrl] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [copied, setCopied] = useState(false);

  async function act(action: "make" | "replace" | "off") {
    setFailure(undefined);
    try {
      const answer = await api.clientLink(client.brand.id, action);
      setUrl(answer.url);
      setState(action === "off" ? "off" : "on");
      setCopied(false);
    } catch (cause) {
      setFailure(describeError(cause));
    }
  }
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <p className="text-body">
        {state === "on" ? "The client's link is on." : state === "off" ? "The client's link is turned off: it opens nothing." : "This brand has no client link yet."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {state === undefined ? (
          <Button variant="secondary" size="compact" onClick={() => void act("make")}>
            Make the link
          </Button>
        ) : (
          <Button variant="secondary" size="compact" onClick={() => void act(state === "on" ? "replace" : "make")}>
            {state === "on" ? "Replace the link" : "Make a new link"}
          </Button>
        )}
        {state === "on" ? (
          <Button variant="secondary" size="compact" onClick={() => void act("off")}>
            Turn the link off
          </Button>
        ) : null}
      </div>
      {state === "on" && !url ? <p className="mt-2 text-caption text-muted-foreground">The studio keeps no copy of the link. If it is lost, replace it: the old link then opens nothing.</p> : null}
      {url ? (
        <Banner status="success" className="mt-3">
          <BannerTitle>
            <span className="break-all font-mono text-caption">{url}</span>
          </BannerTitle>
          <p className="mt-1 text-caption">Copy it now and send it to your client yourself. It is not shown again.</p>
          <Button variant="secondary" size="compact" className="mt-2" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy the link"}
          </Button>
        </Banner>
      ) : null}
      {failure ? (
        <Banner status="error" className="mt-3">
          <BannerTitle>{failure}</BannerTitle>
        </Banner>
      ) : null}
    </div>
  );
}

function CommentList({ pack, onMark }: { pack: OwnerClientPack; onMark: (id: string, to: { hidden: boolean } | { status: ChangeStatus }) => void }) {
  return (
    <div className="mt-3">
      <h4 className="mb-1 text-caption font-medium text-muted-foreground">Comments and change requests</h4>
      {pack.comments.length === 0 ? (
        <p className="text-caption text-muted-foreground">None yet.</p>
      ) : (
        <ul className="space-y-3">
          {pack.comments.map((comment) => (
            <li key={comment.id} className={comment.hidden ? "opacity-60" : undefined}>
              <p className="whitespace-pre-wrap break-words text-body">{comment.text}</p>
              <p className="text-caption text-muted-foreground">
                {[comment.adName ? `On ${comment.adName}` : "On the pack", comment.change ? `${CHANGE_KIND[comment.change.what]}: ${changeStatus(comment.change)}` : undefined, when(comment.at), comment.hidden ? "hidden from the client's page" : undefined]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {comment.change ? <StatusButtons comment={comment} onStatus={(status) => onMark(comment.id, { status })} /> : null}
                <Button variant="secondary" size="compact" className="mt-3" onClick={() => onMark(comment.id, { hidden: !comment.hidden })} aria-label={`${comment.hidden ? "Show" : "Hide"}: ${comment.text.slice(0, 60)}`}>
                  {comment.hidden ? "Show on the client's page" : "Hide from the client's page"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Files({ pack }: { pack: OwnerClientPack }) {
  const [tables, setTables] = useState<Record<string, UploadTable | string>>({});
  async function show(id: string) {
    try {
      const table = await api.uploadTable(pack.packId, id);
      setTables((all) => ({ ...all, [id]: table }));
    } catch (cause) {
      setTables((all) => ({ ...all, [id]: describeError(cause) }));
    }
  }
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-caption font-medium text-muted-foreground">Files the client sent</h4>
      {pack.uploads.length === 0 ? (
        <p className="text-caption text-muted-foreground">None yet.</p>
      ) : (
        <ul className="space-y-2 text-caption">
          {pack.uploads.map((upload) => {
            const table = tables[upload.id];
            return (
              <li key={upload.id}>
                {upload.openUrl ? <OutLink href={upload.openUrl}>{upload.name}</OutLink> : <span className={upload.state === "refused" || upload.state === "missing" ? "line-through" : undefined}>{upload.name}</span>}
                {upload.state !== "checked" ? <span className="text-muted-foreground"> · {UPLOAD_STATE[upload.state ?? "arriving"]}</span> : null}
                <span className="text-muted-foreground"> · {when(upload.at)}</span>
                {upload.state === "checked" && upload.type === "text/csv" && table === undefined ? (
                  <Button variant="secondary" size="compact" className="ml-2" onClick={() => void show(upload.id)} aria-label={`Show ${upload.name} as a table`}>
                    Show as a table
                  </Button>
                ) : null}
                {typeof table === "string" ? <p className="mt-1 text-muted-foreground">{table}</p> : null}
                {table !== undefined && typeof table !== "string" ? <CsvTable name={upload.name} table={table} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-caption text-muted-foreground">The studio reads each file first and deletes one that is not the picture or the CSV it was sent as. A CSV is shown here as text; it is never opened in a spreadsheet program.</p>
    </div>
  );
}

/** A client's CSV as rows of text. A cell is put on the page as characters, so a formula or markup in it does nothing. */
function CsvTable({ name, table }: { name: string; table: UploadTable }) {
  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
      <table aria-label={`The file ${name}`} className="w-full text-left text-caption">
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t border-border first:border-0 align-top">
              {row.map((cell, column) => (index === 0 ? <th key={column} className="px-2 py-1 font-medium whitespace-nowrap">{cell}</th> : <td key={column} className="px-2 py-1 whitespace-nowrap">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.cut ? <p className="border-t border-border px-2 py-1 text-caption text-muted-foreground">The file is longer than this table shows.</p> : null}
    </div>
  );
}
