import { KIND_NAMES } from "@/lib/kinds";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

/** The pipeline, in the order a batch moves through it. `ready` turns true as each part ships. */
const STAGES = [
  { name: "Brand and product", detail: "Pick a saved brand or give a new address, then one product page.", ready: true },
  { name: "Facts and truth sheet", detail: "Every fact with its exact quote and source. Real size, shape and pack.", ready: true },
  { name: "Three ideas", detail: "One device, one focal point, five elements or fewer. Checked against your taste.", ready: true },
  { name: "Drafts", detail: "Three per idea, each from its own skeleton, measured against the packshot.", ready: true },
  { name: "Your pick", detail: "Drafts beside the truth sheet, numbered and unranked. You choose one per idea.", ready: true },
  { name: "Finals", detail: "High quality, re-measured, with a real-camera finish.", ready: true },
] as const;

export function Home() {
  const mcpAddress = `${window.location.origin}/mcp`;
  const [buildId, setBuildId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const { value: batches, error } = useLoad(api.batches);

  useEffect(() => {
    let current = true;
    api.health().then(
      (health) => current && setBuildId(health.buildId),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  async function copyAddress() {
    await navigator.clipboard.writeText(mcpAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <PageHeader
        title="Studio"
        lead="Three truthful, striking static ads from one brand and one product. Your AI agent runs the work through this studio; you pick."
      />

      <Section title="Connect your agent">
        <Card>
          <p className="text-body text-muted-foreground">
            Add this address as a remote MCP server in your agent. It is the only connection the agent needs. The agent
            signs you in, then waits until you approve it on the{" "}
            <Link to="/connections" className="text-foreground underline underline-offset-4">
              Connections
            </Link>{" "}
            page.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-(--tint) px-3 py-2 font-mono text-caption">{mcpAddress}</code>
            <Button variant="secondary" size="compact" onClick={copyAddress}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Batches" count={batches?.length}>
        {batches === undefined ? (
          <Loading error={error} />
        ) : batches.length === 0 ? (
          <Empty>No batch yet. Your agent starts one when you give it a brand and a product.</Empty>
        ) : (
          <ul className="grid gap-3">
            {batches.map(({ batch, brand, product }) => (
              <li key={batch.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link to={`/batches/${batch.id}`} className="text-body font-medium underline underline-offset-2">
                    {batch.label ?? "Batch"}
                  </Link>
                  <span className="text-body text-muted-foreground">
                    {brand.name}: {product.name}
                  </span>
                  <Badge variant="dot" color={batch.state === "done" ? "green" : "amber"}>
                    {batch.state.replace("_", " ")}
                  </Badge>
                  <Badge color="gray">{KIND_NAMES[batch.kind]}</Badge>
                  <span className="ml-auto text-caption text-muted-foreground">Started {when(batch.createdAt)}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What the studio does">
        <ol className="grid gap-3 sm:grid-cols-2">
          {STAGES.map((stage, index) => (
            <li key={stage.name}>
              <Card className="h-full">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-subtitle font-medium">
                    <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}</span>
                    {stage.name}
                  </span>
                  <Badge variant="dot" color={stage.ready ? "green" : "gray"}>
                    {stage.ready ? "Live" : "Not built yet"}
                  </Badge>
                </div>
                <p className="mt-2 text-body text-muted-foreground">{stage.detail}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {buildId ? <p className="mt-10 text-micro text-muted-foreground">Build {buildId}</p> : null}
    </>
  );
}
