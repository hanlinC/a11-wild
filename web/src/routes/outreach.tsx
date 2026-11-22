import type { TodayLine } from "@a11-wild/shared";
import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { AdPicture, AdVerdict, BrandLine, Failure, MessageCard, OutreachTabs, TAP, useWrite } from "@/components/outreach";
import { Card, PageHeader, Section, Step } from "@/components/page";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { dayName, when } from "@/lib/when";

/** What the owner does today, in his order. Every message is sent by hand; the page only records it. */
export function Outreach() {
  const { value: today, error, reload } = useLoad(api.outreachToday);

  if (today === undefined) {
    return (
      <>
        <Header />
        <Loading error={error} />
      </>
    );
  }
  const done = () => void reload();

  const sections: { title: string; lines: TodayLine[]; none: string; line: (line: TodayLine) => React.ReactNode }[] = [
    { title: "Replies that are owed an answer", lines: today.owed, none: "no reply waits for your answer", line: (line) => <Owed line={line} done={done} /> },
    { title: "Follow-ups due", lines: today.followUps, none: "no follow-up is due", line: (line) => <Message line={line} done={done} /> },
    {
      title: "New first messages",
      lines: today.firsts,
      none: today.firstsSent >= today.daily ? "today's first messages are all sent" : "no brand is ready for a first message",
      line: (line) => <Message line={line} done={done} />,
    },
    {
      title: "Brands that wait for your pick",
      lines: today.picks,
      none: "no brand waits for your pick",
      line: (line) => (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body">
            {line.drafts === 1 ? "1 draft" : `${line.drafts ?? "Some"} drafts`} to choose from. You pick the one to send; the agent then makes it full size.
          </p>
          <Button asChild className={TAP}>
            <Link to={`/outreach/prospects/${line.prospect.id}`}>Pick the ad</Link>
          </Button>
        </div>
      ),
    },
    {
      title: "Ads that wait for your yes or no",
      lines: today.adsWaiting,
      none: "no ad waits for your yes or no",
      line: (line) =>
        line.ad ? (
          <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
            <AdPicture ad={line.ad} brand={line.prospect.brand} />
            <AdVerdict prospect={line.prospect} ad={line.ad} done={done} />
          </div>
        ) : null,
    },
  ];
  const open = sections.filter((section) => section.lines.length > 0);
  const waits = open.reduce((sum, section) => sum + section.lines.length, 0);
  const rest = sections.filter((section) => section.lines.length === 0).map((section) => section.none);

  return (
    <>
      <Header />
      <Step who={waits > 0 ? "you" : "nobody"} left={`${today.firstsSent} of ${today.daily} first messages sent today`}>
        {waits > 0 ? `${waits === 1 ? "1 thing waits" : `${waits} things wait`} for you today, ${dayName(today.day)}.` : `Nothing waits for you today, ${dayName(today.day)}.`}
        {today.sendingDay ? null : <> Not a planned sending day: the next one is {dayName(today.nextSendingDay)}. You can still send today.</>}
        {waits > 0 ? null : " A brand shows here when its drafts are ready for your pick, when a message is due, or when a reply is logged."}
      </Step>
      {today.templates ? null : (
        <Banner status="info">
          <BannerTitle>
            The message text is not loaded yet. Write it on the <Link to="/outreach/messages">Messages</Link> page.
          </BannerTitle>
        </Banner>
      )}

      {open.map((section) => (
        <Section key={section.title} title={section.title} count={section.lines.length}>
          <Lines lines={section.lines}>{section.line}</Lines>
        </Section>
      ))}
      {open.length > 0 && rest.length > 0 ? <p className="mt-10 text-body text-muted-foreground">Nothing else today: {listOf(rest)}.</p> : null}
    </>
  );
}

/** "a, b and c": the parts of a sentence that names each empty group once. */
const listOf = (parts: string[]): string => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

function Header() {
  return (
    <>
      <PageHeader title="Outreach" lead="Your day: the answers you owe, the follow-ups that are due, and the new first messages. You send each one yourself; this page keeps the record." />
      <OutreachTabs />
    </>
  );
}

function Lines({ lines, children }: { lines: TodayLine[]; children: (line: TodayLine) => React.ReactNode }) {
  return (
    <ul className="grid gap-3">
      {lines.map((line) => (
        <li key={line.prospect.id}>
          <Card className="grid gap-4">
            <BrandLine prospect={line.prospect} />
            {children(line)}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Message({ line, done }: { line: TodayLine; done: () => void }) {
  if (line.step === undefined || !line.messages) return <p className="text-caption text-muted-foreground">The message text is not loaded yet.</p>;
  return <MessageCard prospect={line.prospect} ad={line.ad} step={line.step} messages={line.messages} done={done} />;
}

/** A reply the owner has not answered yet. His answer is his own text; he marks it when it is sent. */
function Owed({ line, done }: { line: TodayLine; done: () => void }) {
  const { write, busy, error } = useWrite(line.prospect.id, done);
  return (
    <div className="grid gap-3">
      {line.reply ? (
        <p className="text-body">
          <span className="text-caption text-muted-foreground">Replied {when(line.reply.at)}</span>
          {line.reply.text ? <span className="mt-1 block break-words whitespace-pre-wrap">{line.reply.text}</span> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={TAP} loading={busy === "answered"} onClick={() => write({ action: "answered" })}>
          I answered
        </Button>
        <Button asChild variant="secondary" className={TAP}>
          <Link to={`/outreach/prospects/${line.prospect.id}`}>Open the brand</Link>
        </Button>
      </div>
      <Failure error={error} />
    </div>
  );
}
