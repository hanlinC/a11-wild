import type { OutreachAdView, OutreachChannel, OutreachMessage, OutreachStage, OutreachStep, ProspectPage, ProspectRow } from "@a11-wild/shared";
import { type FormEvent, useState } from "react";
import { Link, NavLink } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Zoom } from "@/components/viewer";
import { api, describeError, type ProspectWrite } from "@/lib/api";
import { cn } from "@/lib/utils";

export const STAGES: Record<OutreachStage, { label: string; color: "green" | "amber" | "gray" | "red" }> = {
  new: { label: "New", color: "gray" },
  no_route: { label: "No route", color: "gray" },
  needs_service_ad: { label: "Needs a service ad", color: "gray" },
  pick_waits: { label: "Pick an ad", color: "amber" },
  pick_made: { label: "Waits for the agent", color: "gray" },
  ad_waits: { label: "Ad waits for you", color: "amber" },
  ready: { label: "Ready to send", color: "green" },
  contacted: { label: "Contacted", color: "green" },
  replied: { label: "Replied", color: "amber" },
  in_talks: { label: "In talks", color: "amber" },
  client: { label: "Client", color: "green" },
  lost: { label: "Lost", color: "gray" },
  parked: { label: "Parked", color: "gray" },
  opted_out: { label: "Opted out", color: "red" },
};
export const STEPS: Record<OutreachStep, string> = { 0: "First message", 1: "Follow-up 1", 2: "Follow-up 2" };
export const CHANNELS: Record<OutreachChannel, string> = { whatsapp: "WhatsApp", email: "Email" };
/** A button large enough for a thumb: the pages are used on a phone first. */
export const TAP = "min-h-11 sm:min-h-0";

const TABS = [
  { to: "/outreach", label: "Today" },
  { to: "/outreach/prospects", label: "Prospects" },
  { to: "/outreach/messages", label: "Messages" },
] as const;

export function OutreachTabs() {
  return (
    <nav aria-label="Outreach" className="mb-6 flex gap-1 border-b border-border pb-2">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) => cn("rounded-md px-3 py-2 text-body transition-colors", isActive ? "bg-(--tint) text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The brand as a line: its name as a link to its page, its tier, its live ads and its stage. */
export function BrandLine({ prospect }: { prospect: ProspectRow }) {
  const stage = STAGES[prospect.stage];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link to={`/outreach/prospects/${prospect.id}`} className="text-subtitle font-medium break-words underline-offset-4 hover:underline">
        {prospect.brand}
      </Link>
      {prospect.test ? <Badge color="amber">Test</Badge> : null}
      <Badge color={stage.color}>{stage.label}</Badge>
      <span className="text-caption text-muted-foreground">
        {prospect.tier} live ads tier · {prospect.liveAds} live · {prospect.sector}
        {prospect.channel ? ` · ${CHANNELS[prospect.channel]}` : ""}
      </span>
    </div>
  );
}

export function AdPicture({ ad, brand }: { ad: OutreachAdView; brand: string }) {
  return (
    <figure className="w-full max-w-64 shrink-0">
      <Zoom url={ad.viewUrl} alt={`Ad ${ad.n} for ${brand}`} className={`aspect-[4/5] w-full rounded-lg border border-border bg-muted ${ad.from === "owner" ? "object-contain" : "object-cover"}`}>
        <p className="text-body font-medium">Ad {ad.n}</p>
        {ad.why ? <p className="text-body text-muted-foreground">{ad.why}</p> : null}
        <CheckNote warning={ad.warning} />
      </Zoom>
      <figcaption className="mt-1.5 text-caption text-muted-foreground">{ad.why}</figcaption>
    </figure>
  );
}

/**
 * What the checks found in a picture of an outreach brand. It blocks nothing: the owner reads it and decides.
 * In a row of drafts it is cut to two lines; the picture opened large gives it in full.
 */
export function CheckNote({ warning, before, short }: { warning: string | undefined; before?: string; short?: boolean }) {
  if (!warning) return null;
  return (
    <p className="text-caption">
      <Badge variant="dot" color="amber">
        The checks found
      </Badge>
      <span className={cn("mt-1 block text-muted-foreground", short && "line-clamp-2")} title={short ? warning : undefined}>
        {warning}
        {short ? null : ` It is your call${before ? ` ${before}` : ""}.`}
      </span>
    </p>
  );
}

/** Runs one write and says in words why it failed. `failed` is the action that failed, so a page shows the reason beside that action. */
export function useWrite(id: string, done: (page: ProspectPage) => void) {
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<{ action: ProspectWrite["action"]; error: string }>();
  async function write(change: ProspectWrite): Promise<boolean> {
    setBusy(change.action);
    try {
      done(await api.prospectWrite(id, change));
      setFailure(undefined);
      return true;
    } catch (cause) {
      setFailure({ action: change.action, error: describeError(cause) });
      return false;
    } finally {
      setBusy(undefined);
    }
  }
  return { write, busy, error: failure?.error, failed: failure?.action };
}

export function Failure({ error }: { error: string | undefined }) {
  return error ? (
    <Banner status="error">
      <BannerTitle>{error}</BannerTitle>
    </Banner>
  ) : null;
}

/** The owner's yes or no to an ad. A no needs his words: the next ad is made from them. */
export function AdVerdict({ prospect, ad, done, takeBack }: { prospect: ProspectRow; ad: OutreachAdView; done: (page: ProspectPage) => void; /** The full-size ad of his own pick: it has his yes, and he can only take that back. */ takeBack?: boolean }) {
  const { write, busy, error } = useWrite(prospect.id, done);
  const [no, setNo] = useState(false);
  const [said, setSaid] = useState("");

  async function sayNo(event: FormEvent) {
    event.preventDefault();
    await write({ action: "ad", body: { ad: ad.n, yes: false, ownerSaid: said.trim() } });
  }

  return (
    <div className="grid gap-3">
      {no ? (
        <form onSubmit={sayNo} className="grid gap-3">
          <label className="grid gap-1.5 text-caption text-muted-foreground">
            {takeBack ? "What is wrong with the full-size version, in one line? You go back to the drafts." : "What is wrong with it, in your own words"}
            <input value={said} onChange={(event) => setSaid(event.target.value)} className={`${FIELD} text-foreground`} required />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className={TAP} loading={busy === "ad"}>
              Save the no
            </Button>
            <Button type="button" variant="ghost" className={TAP} onClick={() => setNo(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : takeBack ? (
        <div>
          <Button type="button" variant="secondary" className={TAP} onClick={() => setNo(true)}>
            Not this after all
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={TAP} loading={busy === "ad"} onClick={() => write({ action: "ad", body: { ad: ad.n, yes: true } })}>
            Yes, send this ad
          </Button>
          <Button type="button" variant="secondary" className={TAP} onClick={() => setNo(true)}>
            No
          </Button>
        </div>
      )}
      <Failure error={error} />
    </div>
  );
}

/**
 * One message to send by hand: the two versions of its title, its text, and the four actions.
 * Nothing here sends a message. "Mark as sent" only records that the owner sent it himself.
 */
export function MessageCard({
  prospect,
  ad,
  step,
  messages,
  done,
}: {
  prospect: ProspectRow;
  ad: OutreachAdView | undefined;
  step: OutreachStep;
  messages: [OutreachMessage, OutreachMessage];
  done: (page: ProspectPage) => void;
}) {
  const { write, busy, error } = useWrite(prospect.id, done);
  const [title, setTitle] = useState<0 | 1>(0);
  const [copied, setCopied] = useState(false);
  const message = messages[title];
  const email = prospect.channel === "email";
  // In WhatsApp the title is the first line of the text. In an email it is the subject, so the text is copied alone.
  const toCopy = email ? message.text : `${message.title}\n\n${message.text}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
      {ad ? <AdPicture ad={ad} brand={prospect.brand} /> : null}
      <div className="grid min-w-0 content-start gap-3">
        <p className="text-caption text-muted-foreground">
          {STEPS[step]}
          {prospect.channel ? ` by ${CHANNELS[prospect.channel]}` : ""}
        </p>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-caption text-muted-foreground">{email ? "Subject" : "Title"}: use either one</legend>
          {messages.map((version, index) => (
            <label key={version.title} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-body", title === index ? "border-foreground" : "border-border")}>
              <input type="radio" name={`title-${prospect.id}-${step}`} checked={title === index} onChange={() => (setTitle(index as 0 | 1), setCopied(false))} className="mt-1" />
              <span className="min-w-0 break-words">{version.title}</span>
            </label>
          ))}
        </fieldset>
        <p className="rounded-lg border border-border bg-background px-3 py-2 text-body break-words whitespace-pre-wrap">{message.text}</p>
        <CheckNote warning={ad?.warning} before="before you send" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className={TAP} onClick={copy}>
            {copied ? "Copied" : "Copy the text"}
          </Button>
          {message.href ? (
            <Button asChild variant="secondary" className={TAP}>
              <a href={message.href} target="_blank" rel="noopener noreferrer">
                {email ? "Open the mail program" : "Open WhatsApp"}
              </a>
            </Button>
          ) : null}
          {ad ? (
            <Button asChild variant="secondary" className={TAP}>
              <a href={ad.downloadUrl}>Save the picture</a>
            </Button>
          ) : null}
          <Button type="button" className={TAP} loading={busy === "sent"} onClick={() => write({ action: "sent", body: { step, title } })}>
            Mark as sent
          </Button>
        </div>
        <Failure error={error} />
      </div>
    </div>
  );
}
