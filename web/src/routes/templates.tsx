import type { OutreachStep, OutreachTemplates, TemplatesPage } from "@a11-wild/shared";
import { type FormEvent, useState } from "react";
import { FIELD } from "@/components/canon-card";
import { Loading } from "@/components/loading";
import { Failure, OutreachTabs, STEPS, TAP } from "@/components/outreach";
import { Card, PageHeader, Section, Step } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

const EMPTY: OutreachTemplates["steps"] = [
  { titles: ["", ""], body: "" },
  { titles: ["", ""], body: "" },
  { titles: ["", ""], body: "" },
];

/** The owner's three messages and his daily number of first messages. Only he changes them. */
export function Templates() {
  const { value: page, error, reload } = useLoad(api.outreachTemplates);
  return (
    <>
      <PageHeader title="Messages" lead="Your three messages, in your own words. Each has two versions of its title; you use either one when you send." />
      <OutreachTabs />
      {page === undefined ? <Loading error={error} /> : <Body key={page.templates?.savedAt ?? "none"} page={page} reload={reload} />}
    </>
  );
}

function Body({ page, reload }: { page: TemplatesPage; reload: () => Promise<void> }) {
  const [steps, setSteps] = useState<OutreachTemplates["steps"]>(page.templates?.steps ?? EMPTY);
  const [daily, setDaily] = useState(String(page.daily));
  const [busy, setBusy] = useState<"text" | "daily">();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const change = (step: OutreachStep, next: Partial<{ title0: string; title1: string; body: string }>) =>
    setSteps((before) => before.map((entry, index) => (index === step ? { titles: [next.title0 ?? entry.titles[0], next.title1 ?? entry.titles[1]], body: next.body ?? entry.body } : entry)) as OutreachTemplates["steps"]);

  async function run(what: "text" | "daily", event: FormEvent, save: () => Promise<unknown>, said: string) {
    event.preventDefault();
    setBusy(what);
    setSaved(undefined);
    try {
      await save();
      setError(undefined);
      setSaved(said);
      if (what === "text") await reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <>
      {page.templates ? (
        <Step who="nobody" left={`Last saved ${when(page.templates.savedAt)}`}>
          Your three messages are saved. Change them here when you want other words.
        </Step>
      ) : (
        <Step who="you">Write your three messages and save them. No message is ready for any brand before that.</Step>
      )}
      <form onSubmit={(event) => run("text", event, () => api.saveOutreachTemplates(steps), "The messages are saved.")}>
        <p className="mb-4 max-w-2xl text-caption text-muted-foreground">
          Write {page.placeholder} where the brand's name goes. It is the only placeholder. A message that was sent keeps the text it was sent with.
        </p>
        {([0, 1, 2] as const).map((step) => (
          <Section key={step} title={STEPS[step]}>
            <Card className="grid gap-3">
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                Title, version 1
                <input value={steps[step].titles[0]} onChange={(event) => change(step, { title0: event.target.value })} maxLength={200} className={`${FIELD} text-foreground`} required />
              </label>
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                Title, version 2
                <input value={steps[step].titles[1]} onChange={(event) => change(step, { title1: event.target.value })} maxLength={200} className={`${FIELD} text-foreground`} required />
              </label>
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                Text
                <textarea value={steps[step].body} onChange={(event) => change(step, { body: event.target.value })} rows={10} maxLength={4000} className={`${FIELD} text-foreground`} required />
              </label>
            </Card>
          </Section>
        ))}
        <div className="mt-4">
          <Button type="submit" className={TAP} loading={busy === "text"}>
            Save the messages
          </Button>
        </div>
      </form>

      <Section title="First messages a day">
        <Card>
          <form onSubmit={(event) => run("daily", event, () => api.setOutreachDaily(Number(daily)), "The daily number is saved.")} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-caption text-muted-foreground">
              From {page.dailyMin} to {page.dailyMax}. Follow-ups and answers do not count.
              <input type="number" min={page.dailyMin} max={page.dailyMax} value={daily} onChange={(event) => setDaily(event.target.value)} className={`${FIELD} max-w-24 text-foreground`} required />
            </label>
            <Button type="submit" variant="secondary" className={TAP} loading={busy === "daily"}>
              Save the number
            </Button>
          </form>
        </Card>
      </Section>

      <div className="mt-4 grid gap-2">
        {saved ? (
          <p role="status" className="text-body">
            {saved}
          </p>
        ) : null}
        <Failure error={error} />
      </div>
    </>
  );
}
