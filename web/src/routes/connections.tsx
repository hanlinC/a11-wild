import type { ClientRecord } from "@a11-wild/shared";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { when } from "@/lib/when";
import { useMe } from "@/lib/session";


type Action = "approve" | "revoke";

export function Connections() {
  const isOwner = useMe().role === "owner";
  const [clients, setClients] = useState<ClientRecord[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [confirming, setConfirming] = useState<string>();

  const load = useCallback(async () => {
    try {
      setClients(await api.clients());
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: Action, clientId: string) {
    setBusy(clientId);
    setError(undefined);
    try {
      const updated = await (action === "approve" ? api.approveClient(clientId) : api.revokeClient(clientId));
      setClients((list) => list?.map((client) => (client.clientId === clientId ? updated : client)));
    } catch (cause) {
      setError(describeError(cause));
      await load();
    } finally {
      setBusy(undefined);
      setConfirming(undefined);
    }
  }

  const pending = clients?.filter((client) => client.status === "pending") ?? [];
  const approved = clients?.filter((client) => client.status === "approved") ?? [];
  const revoked = clients?.filter((client) => client.status === "revoked") ?? [];

  const row = (client: ClientRecord) => (
    <li key={client.clientId}>
      <Card className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-subtitle font-medium break-all">{client.name || "Unnamed program"}</span>
            <StatusBadge status={client.status} />
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-caption sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Sends you back to</dt>
            <dd className="min-w-0">
              {client.callbackUrls.length === 0
                ? "No address given"
                : client.callbackUrls.map((url) => (
                    <span key={url} className="block font-mono break-all">
                      {url}
                    </span>
                  ))}
            </dd>
            <dt className="text-muted-foreground">First seen</dt>
            <dd>
              {when(client.firstSeenAt)} · signed in as {client.firstSeenBy}
            </dd>
            {client.decidedAt ? (
              <>
                <dt className="text-muted-foreground">{client.status === "revoked" ? "Removed" : "Approved"}</dt>
                <dd>{when(client.decidedAt)}</dd>
              </>
            ) : null}
          </dl>
        </div>
        {isOwner && client.status !== "revoked" ? (
          <div className="flex items-center gap-2">
            {client.status === "pending" ? (
              <Button size="compact" loading={busy === client.clientId} onClick={() => act("approve", client.clientId)}>
                Approve
              </Button>
            ) : null}
            {confirming === client.clientId ? (
              <>
                <Button
                  variant="destructive"
                  size="compact"
                  loading={busy === client.clientId}
                  onClick={() => act("revoke", client.clientId)}
                >
                  Yes, remove it
                </Button>
                <Button variant="ghost" size="compact" onClick={() => setConfirming(undefined)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="tertiary" size="compact" onClick={() => setConfirming(client.clientId)}>
                {client.status === "pending" ? "Reject" : "Revoke"}
              </Button>
            )}
          </div>
        ) : null}
      </Card>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Connections"
        lead="Programs that asked to use the studio on your behalf. A new one can do nothing until the owner approves it. Approve only a program you started yourself, and check where it sends you back to."
      />

      {error ? (
        <Banner status="error" className="mb-6">
          <BannerTitle>{error}</BannerTitle>
        </Banner>
      ) : null}
      {!isOwner ? (
        <Banner status="info" className="mb-6">
          <BannerTitle>Only the owner can approve or remove a connection.</BannerTitle>
        </Banner>
      ) : null}

      {clients === undefined ? (
        error ? null : (
          <p className="text-body text-muted-foreground" aria-busy="true">
            Loading
          </p>
        )
      ) : (
        <>
          <Section title="Waiting for approval" count={pending.length}>
            {pending.length === 0 ? (
              <Empty>Nothing is waiting. A program appears here after it signs in for the first time.</Empty>
            ) : (
              <ul className="grid gap-3">{pending.map(row)}</ul>
            )}
          </Section>
          <Section title="Approved" count={approved.length}>
            {approved.length === 0 ? (
              <Empty>No program is connected yet.</Empty>
            ) : (
              <ul className="grid gap-3">{approved.map(row)}</ul>
            )}
          </Section>
          {revoked.length > 0 ? (
            <Section title="Removed" count={revoked.length}>
              <ul className="grid gap-3">{revoked.map(row)}</ul>
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: ClientRecord["status"] }) {
  if (status === "approved") return <Badge variant="dot" color="green">Approved</Badge>;
  if (status === "pending") return <Badge variant="dot" color="amber">Waiting</Badge>;
  return <Badge variant="dot" color="gray">Removed</Badge>;
}
