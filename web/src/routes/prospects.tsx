import { OUTREACH_STAGES, OUTREACH_TIERS, type OutreachCount, type OutreachNumbers, type OutreachStage, type OutreachTier, type ProspectRow } from "@a11-wild/shared";
import { type FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { FIELD } from "@/components/canon-card";
import { Loading } from "@/components/loading";
import { BrandLine, CHANNELS, Failure, OutreachTabs, STAGES, STEPS, TAP } from "@/components/outreach";
import { Card, Empty, Fold, PageHeader, Section } from "@/components/page";
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

/** The stages listed first, in the order the owner takes them: a reply, then what waits for his pick, his yes or his message. A row does not say if a reply is answered, so the list gives no count. */
const WAITS: OutreachStage[] = ["replied", "pick_waits", "ad_waits", "ready"];
const rank = (row: ProspectRow): number => (WAITS.includes(row.stage) ? WAITS.indexOf(row.stage) : WAITS.length);
/** How many rows are drawn at once: the list is long, and a page of it opens at once. */
const PAGE = 50;

/** Every brand of the list, the ones that wait for the owner first, with a search by name and three filters. The numbers of the campaign are folded below. */
export function Prospects() {
  const [filter, setFilter] = useState<ProspectFilter>({});
  const load = useCallback(() => api.prospects(filter), [filter]);
  const { value: page, error } = useLoad(load);
  const [shown, setShown] = useState(PAGE);
  const set = (change: ProspectFilter) => (setShown(PAGE), setFilter((before) => ({ ...before, ...change })));
  // A stable sort: within one rank the brands keep the order of the list.
  const rows = page ? [...page.rows].sort((a, b) => rank(a) - rank(b)) : [];
  const first = rows.some((row) => rank(row) < WAITS.length);

  return (
    <>
      <PageHeader title="Prospects" lead="Every brand of your list. A row shows no number and no address; those are on the brand's own page." />
      <OutreachTabs />
      {page === undefined ? (
        <Loading error={error} />
      ) : (
        <>
          <Section title="Brands" count={page.rows.length} mark={first ? <span className="text-caption text-muted-foreground">Replies and the brands that wait for you are listed first</span> : null}>
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
                {rows.slice(0, shown).map((row) => (
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
            {rows.length > shown ? (
              <div className="mt-3">
                <Button type="button" variant="secondary" className={TAP} onClick={() => setShown((before) => before + PAGE)}>
                  Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
                </Button>
              </div>
            ) : null}
          </Section>

          <div className="mt-10">
            <Fold title="Numbers of the campaign" count={page.numbers.prospects}>
              <Numbers numbers={page.numbers} />
            </Fold>
            <Fold title="Try the pages with a test prospect">
              <TestProspect />
            </Fold>
          </div>
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
    <div className="px-2 py-1">
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
    </div>
  );
}
