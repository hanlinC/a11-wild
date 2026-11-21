import { type MetaVariant, type PackView, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type UploadType } from "@a11-wild/shared";
import { useCallback, useState } from "react";
import { useParams } from "react-router";
import { Loading, OutLink } from "@/components/loading";
import { Card, Section } from "@/components/page";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

const STAGES = { tof: "Top of funnel", mof: "Middle of funnel", bof: "Bottom of funnel" } as const;
const ACCEPT = ".jpg,.jpeg,.png,.csv,.xlsx";
const BY_ENDING: Record<string, UploadType> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/** The type of a file by its ending: a browser names the type of a CSV in several ways, or not at all. */
export const typeOf = (name: string): UploadType | undefined => BY_ENDING[name.split(".").at(-1)?.toLowerCase() ?? ""];

/** A client's pack: the ads, the text for Meta, why each ad, the launch plan, and a place to send results. No sign-in. */
export function Pack() {
  const { token = "" } = useParams();
  const load = useCallback(() => api.pack(token), [token]);
  const { value: pack, error } = useLoad(load);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-5">
          <span className="text-title font-semibold tracking-tight">a11 studio</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-10">
        {pack === undefined ? <Loading error={error && "This link does not open a pack. Ask your contact at the studio for the current link."} /> : <PackBody pack={pack} token={token} />}
      </main>
    </div>
  );
}

function PackBody({ pack, token }: { pack: PackView; token: string }) {
  return (
    <>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-display font-semibold tracking-tight">{pack.brand}</h1>
        <p className="mt-2 text-body text-muted-foreground">
          {pack.ads.length} {pack.ads.length === 1 ? "ad" : "ads"} for {pack.product}. Version {pack.version}, {when(pack.at)}.
        </p>
      </header>
      <Section title="Launch plan">
        <Card>
          <ol className="list-decimal space-y-1 pl-5 text-body">
            {pack.launchPlan.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      </Section>
      {pack.ads.map((ad) => (
        <Section key={ad.adName} title={ad.stage ? STAGES[ad.stage] : "Ad"}>
          <Card className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <figure>
              <a href={ad.viewUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                <img src={ad.viewUrl} alt={`The ad ${ad.adName}`} referrerPolicy="no-referrer" className="aspect-[4/5] w-full rounded-lg bg-(--tint) object-cover" />
              </a>
              <figcaption className="mt-2 text-caption text-muted-foreground">Open the picture to save it at full size.</figcaption>
            </figure>
            <div className="min-w-0 space-y-5">
              <Copyable label="Ad name" text={ad.adName} mono />
              <p className="text-body">{ad.why}</p>
              {ad.meta.variants.map((variant, index) => (
                <MetaText key={index === 0 ? "a" : "b"} name={index === 0 ? "Text A" : "Text B"} variant={variant} />
              ))}
              {ad.claims.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-caption font-medium text-muted-foreground">Fact check</h3>
                  <ul className="space-y-2 text-caption">
                    {ad.claims.map((claim) => (
                      <li key={claim.claim}>
                        {claim.claim}
                        <span className="text-muted-foreground"> · "{claim.quote}" · </span>
                        <OutLink href={claim.url}>source</OutLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Card>
        </Section>
      ))}
      <Section title="Send your results">
        <Results token={token} />
      </Section>
    </>
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
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-caption text-muted-foreground">{label}</div>
        <div className={mono ? "break-all font-mono text-caption" : "whitespace-pre-wrap text-body"}>{text}</div>
      </div>
      <Button variant="secondary" size="compact" onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

type Sent = { name: string; state: "sending" | "sent" | "failed"; message?: string };

function Results({ token }: { token: string }) {
  const [files, setFiles] = useState<Sent[]>([]);

  async function send(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      const set = (entry: Sent) => setFiles((all) => [...all.filter((other) => other.name !== file.name), entry]);
      const type = typeOf(file.name);
      if (!type || !Object.hasOwn(UPLOAD_TYPES, type)) {
        set({ name: file.name, state: "failed", message: "Send a JPEG or PNG screenshot, or a CSV or XLSX export." });
        continue;
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        set({ name: file.name, state: "failed", message: "A file can be up to 10 MB." });
        continue;
      }
      set({ name: file.name, state: "sending" });
      try {
        await api.sendResult(token, file, type);
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
      <p className="mt-1 text-caption text-muted-foreground">JPEG, PNG, CSV or XLSX, up to 10 MB each.</p>
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
