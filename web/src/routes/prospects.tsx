import { OUTREACH_STAGES, OUTREACH_TIERS, type OutreachCount, type OutreachNumbers, type OutreachStage, type OutreachTier } from "@a11-wild/shared";
import { type FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Loading } from "@/components/loading";
import { BrandLine, CHANNELS, Failure, OutreachTabs, STAGES, STEPS, TAP } from "@/components/outreach";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, describeError, type ProspectFilter } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { dayName } from "@/lib/when";

const COUNTS: [keyof Omit<OutreachNumbers, "prospects">, string][] = [
  ["sent", "Sent"],
  ["replied", "Replied"],
  ["saidMore", "Said more"],
  ["optedOut", "Opted out"],
  ["clients", "Clients"],
];

/** Every brand of the list, with a search by name, three filters, and the numbers of the campaign. */
export function Prospects() {
  const [filter, setFilter] = useState<ProspectFilter>({});
  const load = useCallback(() => api.prospects(filter), [filter]);
  const { value: page, error } = useLoad(load);
  const set = (change: ProspectFilter) => setFilter((before) => ({ ...before, ...change }));

  return (
    <>
      <PageHeader title="Prospects" lead="Every brand of your list. A row shows no number and no address; those are on the brand's own page." />
      <OutreachTabs />
      {page === undefined ? (
        <Loading error={error} />
      ) : (
        <>
          <Section title="Numbers" count={page.numbers.prospects}>
            <Numbers numbers={page.numbers} />
          </Section>

          <Section title="Brands" count={page.rows.length}>
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1.5 text-caption text-muted-foreground">
                Search by name
                <input type="search" value={filter.q ?? ""} onChange={(event) => set({ q: event.target.value })} className={`${FIELD} text-foreground`} />
              </label>
              <Choice label="Tier" value={filter.tier} options={OUTREACH_TIERS.map((tier) => [tier, `${tier} live ads`])} onChange={(tier) => set({ tier: tier as OutreachTier | undefined })} />
              <Choice label="Sector" value={filter.sector} options={page.sectors.map((sector) => [sector, sector])} onChange={(sector) => set({ sector })} />
              <Choice label="Stage" value={filter.stage} options={OUTREACH_STAGES.map((stage) => [stage, STAGES[stage].label])} onChange={(stage) => set({ stage: stage as OutreachStage | undefined })} />
            </div>
            {page.rows.length === 0 ? (
              <Empty>{page.numbers.prospects === 0 ? "The list is not loaded yet." : "No brand fits the search and the filters."}</Empty>
            ) : (
              <ul className="grid gap-2">
                {page.rows.map((row) => (
                  <li key={row.id}>
                    <Card className="grid gap-1 px-4 py-3">
                      <BrandLine prospect={row} />
                      {row.next || row.sameContactAs ? (
                        <p className="text-caption text-muted-foreground">
                          {row.next ? `${STEPS[row.next.step]} is due ${dayName(row.next.due)}.` : null}
                          {row.sameContactAs ? ` Same contact as ${row.sameContactAs}.` : null}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Try the pages">
            <TestProspect />
          </Section>
        </>
      )}
    </>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string | undefined; options: [string, string][]; onChange: (value: string | undefined) => void }) {
  return (
    <label className="grid gap-1.5 text-caption text-muted-foreground">
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} className={`${FIELD} text-foreground`}>
        <option value="">All</option>
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Numbers({ numbers }: { numbers: OutreachNumbers }) {
  const cell = (count: OutreachCount, key: string, value: number) => (
    <td key={key} className="px-3 py-2 text-right tabular-nums">
      {value}
    </td>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-body">
        <thead className="text-caption text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-normal">
              Brands
            </th>
            <th scope="col" className="px-3 py-2 text-right font-normal">
              All
            </th>
            {OUTREACH_TIERS.map((tier) => (
              <th key={tier} scope="col" className="px-3 py-2 text-right font-normal">
                {tier}
              </th>
            ))}
            {(["whatsapp", "email"] as const).map((channel) => (
              <th key={channel} scope="col" className="px-3 py-2 text-right font-normal">
                {CHANNELS[channel]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COUNTS.map(([name, label]) => {
            const count = numbers[name];
            return (
              <tr key={name} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {label}
                </th>
                {cell(count, "all", count.all)}
                {OUTREACH_TIERS.map((tier) => cell(count, tier, count.byTier[tier]))}
                {(["whatsapp", "email"] as const).map((channel) => cell(count, channel, count.byChannel[channel]))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A made-up prospect with a grey block as its ad, to try every step. It is in no number and can be removed. */
function TestProspect() {
  const navigate = useNavigate();
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function make(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { id } = await api.makeTestProspect({ ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}) });
      void navigate(`/outreach/prospects/${id}`);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={make} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="grid gap-1.5 text-caption text-muted-foreground">
          Your own WhatsApp number, if you want the link to open
          <input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} inputMode="tel" className={`${FIELD} text-foreground`} />
        </label>
        <label className="grid gap-1.5 text-caption text-muted-foreground">
          Or your own address
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${FIELD} text-foreground`} />
        </label>
        <Button type="submit" variant="secondary" className={TAP} loading={busy}>
          Make a test prospect
        </Button>
      </form>
      <p className="mt-3 text-caption text-muted-foreground">It counts in no number, takes no place of the day, and you can remove it on its page.</p>
      <div className="mt-3">
        <Failure error={error} />
      </div>
    </Card>
  );
}
