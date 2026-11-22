import type { OutreachEvent, ProspectPage } from "@a11-wild/shared";
import { type FormEvent, useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Loading, OutLink } from "@/components/loading";
import { AdPicture, AdVerdict, BrandLine, CHANNELS, Failure, MessageCard, OutreachTabs, STAGES, STEPS, TAP, useWrite } from "@/components/outreach";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { dayName, when } from "@/lib/when";

const OWNER_STAGES = ["in_talks", "client", "lost", "parked"] as const;

/** One brand: how to reach it, its ad, the message to send, and everything that happened, newest first. */
export function Prospect() {
  const { id = "" } = useParams();
  const load = useCallback(() => api.prospect(id), [id]);
  const { value: page, error, setValue } = useLoad(load);

  return (
    <>
      <PageHeader title="Prospect" lead="One brand of your list. Only you see its number and its address." />
      <OutreachTabs />
      {page === undefined ? <Loading error={error} /> : <Body page={page} done={setValue} />}
    </>
  );
}

function Body({ page, done }: { page: ProspectPage; done: (page: ProspectPage) => void }) {
  const { prospect, contact, ads, sends } = page;
  const { write, busy, error } = useWrite(prospect.id, done);
  const newest = ads[0];
  const out = prospect.stage === "opted_out";
  const lastSend = sends.at(-1);

  return (
    <>
      <Card className="grid gap-2">
        <BrandLine prospect={prospect} />
        <p className="text-caption text-muted-foreground">
          Number {prospect.n} in your list
          {page.newestAd ? ` · newest ad ${dayName(page.newestAd)}` : ""}
          {page.sells ? ` · sells a ${page.sells}` : ""}
        </p>
        {prospect.sameContactAs ? (
          <div className="flex flex-wrap items-center gap-2 text-body">
            Same contact as {prospect.sameContactAs}: it gets no first message until you choose it.
            <Button type="button" variant="secondary" size="compact" loading={busy === "choose"} onClick={() => write({ action: "choose" })}>
              Send to this brand too
            </Button>
          </div>
        ) : null}
        {out ? <p className="text-body">This contact opted out. No message goes to it, and none is recorded.</p> : null}
      </Card>

      {page.owed ? (
        <Section title="A reply waits for your answer">
          <Card className="grid gap-3">
            <p className="text-body break-words whitespace-pre-wrap">{page.owed.text ?? "No text was saved with the reply."}</p>
            <div>
              <Button type="button" className={TAP} loading={busy === "answered"} onClick={() => write({ action: "answered" })}>
                I answered
              </Button>
            </div>
          </Card>
        </Section>
      ) : null}

      {page.messageFrom && !out ? (
        <p className="text-body">
          <span className="font-medium">No sending today.</span> The message of this brand is here on {dayName(page.messageFrom)}, the next sending day.
        </p>
      ) : null}

      {page.message && !out ? (
        <Section title="The message to send now">
          <Card>
            <MessageCard prospect={prospect} ad={ads.find((ad) => ad.verdict === "yes")} step={page.message.step} messages={page.message.messages} done={done} />
          </Card>
        </Section>
      ) : null}

      <Section title="Ads" count={ads.length}>
        {ads.length === 0 ? (
          <Empty>No ad yet. The agent makes one, and it then waits here for your yes or no.</Empty>
        ) : (
          <ul className="grid gap-3">
            {ads.map((ad) => (
              <li key={ad.n}>
                <Card className="grid gap-4 sm:grid-cols-[16rem_1fr]">
                  <AdPicture ad={ad} brand={prospect.brand} />
                  <div className="grid content-start gap-3">
                    <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                      Ad {ad.n} · {when(ad.at)}
                      {ad.verdict ? <Badge color={ad.verdict === "yes" ? "green" : "gray"}>{ad.verdict === "yes" ? "You said yes" : "You said no"}</Badge> : null}
                    </p>
                    {!ad.verdict && ad.n === newest?.n && !out ? <AdVerdict prospect={prospect} ad={ad} done={done} /> : null}
                    <a href={ad.downloadUrl} className="text-body underline underline-offset-4">
                      Save the picture
                    </a>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="How to reach it">
        <Card>
          <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[10rem_1fr]">
            {contact.whatsapp.map((entry) => (
              <Line key={entry.number} name="WhatsApp" text={`+${entry.number}`} href={entry.href} />
            ))}
            {contact.email ? <Line name="Email" text={contact.email.address} href={contact.email.href} /> : null}
            {contact.phone ? <Line name="Phone" text={contact.phone} /> : null}
            {contact.instagram ? <Line name="Instagram" text={contact.instagram.name} href={contact.instagram.href} /> : null}
            {contact.decisionMaker ? <Line name="Person" text={`${contact.decisionMaker}${contact.dmTitle ? `, ${contact.dmTitle}` : ""}`} /> : null}
            {contact.linkedin ? <Line name="LinkedIn" text={contact.linkedin.text} href={contact.linkedin.href} /> : null}
            {contact.bestRoute ? <Line name="Best route" text={contact.bestRoute} /> : null}
            {contact.secondRoute ? <Line name="Second route" text={contact.secondRoute} /> : null}
          </dl>
          {contact.whatsapp.length > 0 && contact.email && !out ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              Messages go by {prospect.channel ? CHANNELS[prospect.channel] : "no channel"}.
              <Button type="button" variant="secondary" size="compact" loading={busy === "channel"} onClick={() => write({ action: "channel", body: { channel: prospect.channel === "whatsapp" ? "email" : "whatsapp" } })}>
                Use {CHANNELS[prospect.channel === "whatsapp" ? "email" : "whatsapp"]}
              </Button>
            </div>
          ) : null}
        </Card>
      </Section>

      {out ? null : (
        <Section title="What happened">
          <Card className="grid gap-6">
            {sends.length > 0 ? <Reply id={prospect.id} done={done} /> : null}
            <Note id={prospect.id} done={done} />
            <div className="grid gap-2">
              <p className="text-caption text-muted-foreground">Set the stage yourself</p>
              <div className="flex flex-wrap gap-2">
                {OWNER_STAGES.map((stage) => (
                  <Button key={stage} type="button" variant={prospect.stage === stage ? "primary" : "secondary"} size="compact" className={TAP} loading={busy === "stage"} onClick={() => write({ action: "stage", body: { stage } })}>
                    {STAGES[stage].label}
                  </Button>
                ))}
                <Button type="button" variant="ghost" size="compact" className={TAP} onClick={() => write({ action: "stage", body: { stage: "auto" } })}>
                  Back to its own stage
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {page.sells !== "service" ? (
                <Button type="button" variant="ghost" size="compact" className={TAP} onClick={() => write({ action: "kind", body: { kind: "service" } })}>
                  It sells a service
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="compact" className={TAP} onClick={() => write({ action: "kind", body: { kind: "product" } })}>
                  It sells a product
                </Button>
              )}
              {lastSend && lastSend.day === page.day ? (
                <Button type="button" variant="ghost" size="compact" className={TAP} loading={busy === "unsent"} onClick={() => write({ action: "unsent", body: { step: lastSend.step } })}>
                  Take back "{STEPS[lastSend.step]} sent"
                </Button>
              ) : null}
              <OptOut onYes={() => write({ action: "optout" })} busy={busy === "optout"} />
            </div>
            <Failure error={error} />
          </Card>
        </Section>
      )}

      <Section title="Timeline">
        <Timeline page={page} />
      </Section>

      {prospect.test ? <Remove id={prospect.id} /> : null}
    </>
  );
}

function Line({ name, text, href }: { name: string; text: string; href?: string | undefined }) {
  return (
    <>
      <dt className="text-caption text-muted-foreground">{name}</dt>
      {/* A value of the list is shown as text. It is a link only when the server checked it. */}
      <dd className="min-w-0 break-words">{href ? <OutLink href={href}>{text}</OutLink> : text}</dd>
    </>
  );
}

function Reply({ id, done }: { id: string; done: (page: ProspectPage) => void }) {
  const { write, busy, error } = useWrite(id, done);
  const [text, setText] = useState("");
  const log = async (reply: "more" | "no" | "other") => {
    if (reply === "no" && !window.confirm("A no is an opt-out: this contact gets no message again, from any brand that shares it. Save it?")) return;
    if (await write({ action: "reply", body: { reply, ...(text.trim() ? { text: text.trim() } : {}) } })) setText("");
  };
  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5 text-caption text-muted-foreground">
        Log a reply: what they wrote, if you want to keep it
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={2} className={`${FIELD} text-foreground`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="compact" className={TAP} loading={busy === "reply"} onClick={() => log("more")}>
          They said more
        </Button>
        <Button type="button" variant="secondary" size="compact" className={TAP} onClick={() => log("other")}>
          Another reply
        </Button>
        <Button type="button" variant="secondary" size="compact" className={TAP} onClick={() => log("no")}>
          They said no
        </Button>
      </div>
      <Failure error={error} />
    </div>
  );
}

function Note({ id, done }: { id: string; done: (page: ProspectPage) => void }) {
  const { write, busy, error } = useWrite(id, done);
  const [text, setText] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await write({ action: "note", body: { text: text.trim() } })) setText("");
  }
  return (
    <form onSubmit={save} className="grid gap-2">
      <label className="grid gap-1.5 text-caption text-muted-foreground">
        Add a note
        <input value={text} onChange={(event) => setText(event.target.value)} className={`${FIELD} text-foreground`} required />
      </label>
      <div>
        <Button type="submit" variant="secondary" size="compact" className={TAP} loading={busy === "note"}>
          Save the note
        </Button>
      </div>
      <Failure error={error} />
    </form>
  );
}

/** The opt-out asks once before it saves: it is final. */
function OptOut({ onYes, busy }: { onYes: () => void; busy: boolean }) {
  const [asked, setAsked] = useState(false);
  if (!asked) {
    return (
      <Button type="button" variant="ghost" size="compact" className={TAP} onClick={() => setAsked(true)}>
        Opt this contact out
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-caption">
      Final: no message to this contact again, from any brand that shares it.
      <Button type="button" variant="destructive" size="compact" className={TAP} loading={busy} onClick={onYes}>
        Yes, opt out
      </Button>
      <Button type="button" variant="ghost" size="compact" className={TAP} onClick={() => setAsked(false)}>
        Cancel
      </Button>
    </span>
  );
}

const SAID: { [K in OutreachEvent["type"]]: (event: Extract<OutreachEvent, { type: K }>) => string } = {
  kind: (event) => `Marked as a brand that sells a ${event.kind}.`,
  stage: (event) => (event.stage === "auto" ? "Stage set back to its own." : `Stage set to ${STAGES[event.stage].label}${event.reason ? `: ${event.reason}` : "."}`),
  ad_yes: (event) => `Yes to ad ${event.ad}.`,
  ad_no: (event) => `No to ad ${event.ad}: ${event.ownerSaid}`,
  reply: (event) => `Reply: ${event.reply === "more" ? "they said more" : event.reply === "no" ? "they said no" : "another reply"}${event.text ? `. "${event.text}"` : "."}`,
  answered: () => "You answered the reply.",
  optout: () => "Opted out.",
  unsent: (event) => `"${STEPS[event.step]} sent" was taken back.`,
  note: (event) => `Note: ${event.text}`,
  channel: (event) => `Channel set to ${CHANNELS[event.channel]}.`,
  chosen: () => "You chose to send to this brand too.",
};

function Timeline({ page }: { page: ProspectPage }) {
  const lines = [
    ...page.events.map((event) => ({ at: event.at, by: event.by === "agent" ? "The agent" : "You", text: (SAID[event.type] as (event: OutreachEvent) => string)(event) })),
    ...page.sends.map((send) => ({ at: send.at, by: "You", text: `${STEPS[send.step]} sent by ${CHANNELS[send.channel]}, with the title "${send.title}".` })),
    ...page.ads.map((ad) => ({ at: ad.at, by: "The agent", text: `Ad ${ad.n} attached: ${ad.why}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (lines.length === 0) return <Empty>Nothing has happened with this brand yet.</Empty>;
  return (
    <ol className="grid gap-2">
      {lines.map((line, index) => (
        <li key={`${line.at}-${index}`} className="rounded-lg border border-border px-4 py-3">
          <p className="text-body break-words whitespace-pre-wrap">{line.text}</p>
          <p className="mt-1 text-caption text-muted-foreground">
            {line.by} · {when(line.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Remove({ id }: { id: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setBusy(true);
    try {
      await api.removeTestProspect(id);
      void navigate("/outreach/prospects");
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  }
  return (
    <Section title="Test prospect">
      <Card className="grid gap-3">
        <p className="text-body">This prospect is a test. Removing it takes away everything of it. No brand of your list can be removed.</p>
        <div>
          <Button type="button" variant="destructive" className={TAP} loading={busy} onClick={remove}>
            Remove the test prospect
          </Button>
        </div>
        <Failure error={error} />
      </Card>
    </Section>
  );
}
