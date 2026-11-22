import type { AdResult, PackSummary } from "@a11-wild/shared";
import { Link } from "react-router";
import { Loading, OutLink } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;
const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/** Every client pack: its versions, the files its client sent back, and the numbers typed in from them. */
const UPLOAD_STATE = {
  arriving: "still arriving",
  refused: "deleted: it was not the type it was sent as",
  missing: "never arrived",
} as const;

export function Packs() {
  const { value: packs, error } = useLoad(api.packs);

  return (
    <>
      <PageHeader
        title="Packs"
        lead="What each client received: the ads under their names, version by version, and the results they sent back. A pack's private link is shown once, when your agent publishes it; ask your agent for a new link to replace it."
      />
      {packs === undefined ? (
        <Loading error={error} />
      ) : packs.length === 0 ? (
        <Empty>No pack yet. A pack is made from a done batch, after you approve its Meta text.</Empty>
      ) : (
        packs.map((pack) => <PackCard key={pack.pack.id} pack={pack} />)
      )}
    </>
  );
}

function PackCard({ pack }: { pack: PackSummary }) {
  const current = pack.versions.find((version) => version.version === pack.pack.current);
  const older = pack.versions.filter((version) => version.version !== pack.pack.current).reverse();
  return (
    <Section title={`${pack.brand.name} · ${pack.product.name}`}>
      <Card className="space-y-6">
        <p className="text-caption text-muted-foreground">
          {pack.pack.batchId ? (
            <Link to={`/batches/${pack.pack.batchId}`} className="underline underline-offset-4 hover:text-foreground">
              Its batch
            </Link>
          ) : (
            "Carried in from outside the studio"
          )}{" "}
          · first published {when(pack.pack.createdAt)} by {pack.pack.by}
        </p>
        {current ? (
          <div>
            <h3 className="mb-3 flex flex-wrap items-center gap-2 text-body font-medium">
              Version {current.version} <Badge color="green">The link shows this</Badge>
              <span className="text-caption font-normal text-muted-foreground">{when(current.at)}</span>
            </h3>
            <ul className="grid gap-4 sm:grid-cols-3">
              {current.ads.map((ad) => (
                <li key={ad.adName}>
                  <a href={ad.viewUrl} target="_blank" rel="noopener noreferrer">
                    <img src={ad.viewUrl} alt={`The ad ${ad.adName}`} className="aspect-[4/5] w-full rounded-lg bg-(--tint) object-cover" />
                  </a>
                  <p className="mt-2 break-all font-mono text-caption">{ad.adName}</p>
                  <p className="mt-1 text-caption text-muted-foreground">{ad.why}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {older.length > 0 ? (
          <div>
            <h3 className="mb-2 text-body font-medium">Earlier versions</h3>
            <ul className="space-y-1 text-caption text-muted-foreground">
              {older.map((version) => (
                <li key={version.version}>
                  Version {version.version}, {when(version.at)}: <span className="break-all font-mono">{version.ads.map((ad) => ad.adName).join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <h3 className="mb-2 text-body font-medium">Files the client sent</h3>
          {pack.uploads.length === 0 ? (
            <p className="text-caption text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-1 text-caption">
              {pack.uploads.map((upload) => (
                <li key={upload.id}>
                  {upload.openUrl ? <OutLink href={upload.openUrl}>{upload.name}</OutLink> : <span className={upload.state === "refused" || upload.state === "missing" ? "line-through" : undefined}>{upload.name}</span>}
                  {upload.state !== "checked" && <span className="text-muted-foreground"> · {UPLOAD_STATE[upload.state ?? "arriving"]}</span>}
                  <span className="text-muted-foreground">
                    {" "}
                    · {size(upload.bytes)} · {when(upload.at)} · sent on version {upload.packVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-muted-foreground">The studio reads each file before you can open it, and deletes one that is not the picture or the CSV it was sent as. A CSV is shown as a table of text; it never opens in a spreadsheet program.</p>
        </div>
        <div>
          <h3 className="mb-2 text-body font-medium">Results</h3>
          {pack.results.length === 0 ? <p className="text-caption text-muted-foreground">None yet. Your agent types them in from the client's file.</p> : <ResultsTable results={pack.results} />}
        </div>
      </Card>
    </Section>
  );
}

function ResultsTable({ results }: { results: AdResult[] }) {
  return (
    // Seven columns do not fit a phone: the table keeps its width and scrolls sideways inside the card.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-caption">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-4 font-medium">Ad</th>
            <th className="py-1 pr-4 font-medium">Days</th>
            <th className="py-1 pr-4 font-medium">Impressions</th>
            <th className="py-1 pr-4 font-medium">Clicks</th>
            <th className="py-1 pr-4 font-medium">CTR</th>
            <th className="py-1 pr-4 font-medium">Usual CTR</th>
            <th className="py-1 font-medium">Campaign</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className="border-t border-border align-top">
              <td className="py-2 pr-4 font-mono whitespace-nowrap">{result.adName}</td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {result.from} to {result.to}
              </td>
              <td className="py-2 pr-4">{result.impressions.toLocaleString("en-GB")}</td>
              <td className="py-2 pr-4">{result.clicks.toLocaleString("en-GB")}</td>
              <td className="py-2 pr-4">{percent(result.ctr)}</td>
              <td className="py-2 pr-4">{result.baselineCtr === undefined ? "not given" : percent(result.baselineCtr)}</td>
              <td className="py-2">{result.context}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
