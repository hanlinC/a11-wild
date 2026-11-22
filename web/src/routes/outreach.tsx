import type { TodayLine } from "@a11-wild/shared";
import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { AdPicture, AdVerdict, BrandLine, Failure, MessageCard, OutreachTabs, TAP, useWrite } from "@/components/outreach";
import { Card, Empty, PageHeader, Section } from "@/components/page";
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

  return (
    <>
      <Header />
      <p className="mb-6 text-body" role="status">
        <span className="font-medium">
          {today.firstsSent} of {today.daily}
        </span>{" "}
        first messages sent today, {dayName(today.day)}.
        {today.sendingDay ? null : <> Not a planned sending day: the next one is {dayName(today.nextSendingDay)}. You can still send today.</>}
      </p>
      {today.templates ? null : (
        <Banner status="info">
          <BannerTitle>
            The message text is not loaded yet. Write it on the <Link to="/outreach/messages">Messages</Link> page.
          </BannerTitle>
        </Banner>
      )}

      <Section title="Replies that are owed an answer" count={today.owed.length}>
        {today.owed.length === 0 ? (
          <Empty>No reply waits for your answer.</Empty>
        ) : (
          <Lines lines={today.owed}>{(line) => <Owed line={line} done={done} />}</Lines>
        )}
      </Section>

      <Section title="Follow-ups due" count={today.followUps.length}>
        {today.followUps.length === 0 ? <Empty>No follow-up is due today.</Empty> : <Lines lines={today.followUps}>{(line) => <Message line={line} done={done} />}</Lines>}
      </Section>

      <Section title="New first messages" count={today.firsts.length}>
        {today.firsts.length === 0 ? (
          <Empty>{today.firstsSent >= today.daily ? "Today's first messages are all sent." : "No brand is ready. A brand is ready after your yes to its ad."}</Empty>
        ) : (
          <Lines lines={today.firsts}>{(line) => <Message line={line} done={done} />}</Lines>
        )}
      </Section>

      {today.picks.length > 0 ? (
        <Section title="Brands that wait for your pick" count={today.picks.length}>
          <Lines lines={today.picks}>
            {(line) => (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-body">
                  {line.drafts === 1 ? "1 draft" : `${line.drafts ?? "Some"} drafts`} to choose from. You pick the one to send; the agent then makes it full size.
                </p>
                <Button asChild className={TAP}>
                  <Link to={`/outreach/prospects/${line.prospect.id}`}>Pick the ad</Link>
                </Button>
              </div>
            )}
          </Lines>
        </Section>
      ) : null}

      <Section title="Ads that wait for your yes or no" count={today.adsWaiting.length}>
        {today.adsWaiting.length === 0 ? (
          <Empty>No ad waits for you.</Empty>
        ) : (
          <Lines lines={today.adsWaiting}>
            {(line) =>
              line.ad ? (
                <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
                  <AdPicture ad={line.ad} brand={line.prospect.brand} />
                  <AdVerdict prospect={line.prospect} ad={line.ad} done={done} />
                </div>
              ) : null
            }
          </Lines>
        )}
      </Section>
    </>
  );
}

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
