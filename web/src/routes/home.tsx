import type { AttentionKind, AttentionLine, BatchLine } from "@a11-wild/shared";
import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { Ask, Empty, Fold, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { useAttention } from "@/lib/attention";
import { KIND_NAMES } from "@/lib/kinds";
import { useMe } from "@/lib/session";
import { when } from "@/lib/when";

const many = (count: number, one: string, more: string) => `${count} ${count === 1 ? one : more}`;

/** What each group outside Outreach asks for, and the name of its one action. */
const ASKS: Record<Exclude<AttentionKind, OutreachKind>, { ask: (count: number) => string; about: string; action: string }> = {
  change_requests: { ask: (n) => many(n, "change request from a client", "change requests from clients"), about: "A client asked for a change on an ad. Set where it stands.", action: "Open Clients" },
  taste: { ask: (n) => many(n, "change to your taste waits for your yes", "changes to your taste wait for your yes"), about: "The studio learned something from your picks and asks before it keeps it.", action: "Open Taste" },
  connections: { ask: (n) => many(n, "program waits for your approval", "programs wait for your approval"), about: "A program signed in for the first time. It can do nothing until you approve it.", action: "Open Connections" },
};
const ORDER = Object.keys(ASKS) as (keyof typeof ASKS)[];

/** The work of the Outreach page, in the order of that page. The start page gives it one line, as it has one place. */
const OUTREACH = {
  replies: (n: number) => many(n, "reply to answer", "replies to answer"),
  follow_ups: (n: number) => many(n, "follow-up due", "follow-ups due"),
  firsts: (n: number) => many(n, "first message to send", "first messages to send"),
  ads: (n: number) => many(n, "ad to look at", "ads to look at"),
} satisfies Partial<Record<AttentionKind, (count: number) => string>>;
type OutreachKind = keyof typeof OUTREACH;
const OUTREACH_ORDER = Object.keys(OUTREACH) as OutreachKind[];

const nameOf = ({ batch, brand, product }: BatchLine) => `${batch.label ?? "Batch"} · ${brand.name}: ${product.name}`;

/** The start page. What waits for the owner is first, what is in work is second, and the rest is folded away. */
export function Home() {
  const isOwner = useMe().role === "owner";
  const { value, error } = useAttention();

  if (value === undefined) {
    return (
      <>
        <PageHeader title="Studio" lead="What waits for you, then what is in work." />
        <Loading error={error} />
      </>
    );
  }

  const { batches, lines } = value;
  const aside = (line: BatchLine) => line.batch.test === true || line.batch.purpose === "outreach";
  const asked = isOwner ? batches.filter((line) => line.who === "owner") : [];
  const inWork = batches.filter((line) => !aside(line) && line.who !== "nobody" && !asked.includes(line));
  const outreach = batches.filter((line) => line.batch.purpose === "outreach");
  const tests = batches.filter((line) => line.batch.test === true && line.batch.purpose !== "outreach");
  const done = batches.filter((line) => !aside(line) && line.who === "nobody");
  const found = <K extends AttentionKind>(kinds: readonly K[]) => kinds.flatMap((kind) => lines.filter((line): line is AttentionLine & { kind: K } => line.kind === kind));
  const groups = found(ORDER);
  const sends = found(OUTREACH_ORDER);
  const toSend = sends.reduce((sum, line) => sum + line.count, 0);
  const waiting = asked.length + toSend + groups.reduce((sum, line) => sum + line.count, 0);

  return (
    <>
      <PageHeader title="Studio" lead={isOwner ? "What waits for you, then what is in work." : "What is in work. The owner picks and approves."} />

      {error ? (
        <div className="mb-6">
          <Loading error={error} />
        </div>
      ) : null}

      {isOwner ? (
        <Section title="Needs you" count={waiting}>
          {waiting === 0 ? (
            <Empty>Nothing waits for you. A pick, a yes or a reply shows here the moment it is asked of you.</Empty>
          ) : (
            <ul className="grid gap-3">
              {asked.map((line) =>
                line.chat ? (
                  <Ask key={line.batch.id} about={nameOf(line)} ask={line.text} to={line.to} where="Your agent asks you in chat." />
                ) : (
                  <Ask key={line.batch.id} about={nameOf(line)} ask={line.text} to={line.to} action={line.to.endsWith("/concepts") ? "Open the concepts" : "Open the board"} />
                ),
              )}
              {toSend > 0 ? (
                <Ask about={`${sends.map((line) => OUTREACH[line.kind](line.count)).join(", ")}. You send each message by hand.`} ask={many(toSend, "thing waits in Outreach", "things wait in Outreach")} to="/outreach" action="Open Outreach" />
              ) : null}
              {groups.map((line) => (
                <Ask key={line.kind} about={ASKS[line.kind].about} ask={ASKS[line.kind].ask(line.count)} to={line.to} action={ASKS[line.kind].action} />
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="In work" count={inWork.length}>
        {inWork.length === 0 ? (
          <Empty>
            No batch is in work. Your agent starts one when you give it a brand and a product.
            {batches.length === 0 ? (
              <>
                {" "}
                No agent yet?{" "}
                <Link to="/connections" className="text-foreground underline underline-offset-4">
                  Connect one
                </Link>
                .
              </>
            ) : null}
          </Empty>
        ) : (
          <Batches lines={inWork} />
        )}
      </Section>

      {outreach.length + tests.length + done.length > 0 ? (
        <div className="mt-10">
          {done.length > 0 ? (
            <Fold title="Done" count={done.length}>
              <Batches lines={done} />
            </Fold>
          ) : null}
          {outreach.length > 0 ? (
            <Fold title="Outreach batches" count={outreach.length}>
              <p className="px-2 pb-3 text-caption text-muted-foreground">Made to show a brand what the studio can do. The agent chooses in them; your yes or no to each ad is asked above.</p>
              <Batches lines={outreach} />
            </Fold>
          ) : null}
          {tests.length > 0 ? (
            <Fold title="Test batches" count={tests.length}>
              <p className="px-2 pb-3 text-caption text-muted-foreground">Runs that try the studio. The picks in them are not yours and teach it nothing.</p>
              <Batches lines={tests} />
            </Fold>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Batches as plain rows: the name is the link, and the step says who acts next. */
function Batches({ lines }: { lines: BatchLine[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {lines.map((line) => (
        <li key={line.batch.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
          <div className="min-w-0 flex-1 basis-64">
            <Link to={line.to} className="text-body font-medium underline underline-offset-2">
              {line.batch.label ?? "Batch"}
            </Link>
            <span className="ml-2 text-body text-muted-foreground">
              {line.brand.name}: {line.product.name}
            </span>
            <p className="mt-0.5 text-caption text-muted-foreground">{line.text}</p>
          </div>
          <Badge color="gray">{KIND_NAMES[line.batch.kind]}</Badge>
          <span className="text-caption text-muted-foreground">Started {when(line.batch.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
