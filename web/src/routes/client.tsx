import { useCallback } from "react";
import { useParams } from "react-router";
import { Loading } from "@/components/loading";
import { Empty } from "@/components/page";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { LinkPage, PackBody, PackLead, TopLine } from "./pack";

/** A client's page: every pack of the brand behind one private link, newest first. No sign-in. */
export function Client() {
  const { token = "" } = useParams();
  const load = useCallback(() => api.client(token), [token]);
  const { value: client, error } = useLoad(load);

  return (
    <LinkPage>
      {client === undefined ? (
        <Loading error={error && "This link does not open a page. Ask your contact at the studio for the current link."} />
      ) : (
        <>
          <TopLine brand={client.brand}>Your ads from a11 studio, newest first.</TopLine>
          {client.packs.length === 0 ? <Empty>Your first pack appears here when it is ready.</Empty> : null}
          {client.packs.map((pack, index) => (
            <section key={pack.ref} aria-label={`${pack.product}, version ${pack.version}`} className="mt-16 border-t border-border pt-10 first-of-type:mt-4 first-of-type:border-0 first-of-type:pt-0">
              <header className="mb-2">
                <h2 className="text-title font-semibold tracking-tight">{pack.product}</h2>
                <PackLead pack={pack} />
              </header>
              <PackBody pack={pack} door={`/api/client/${encodeURIComponent(token)}/packs/${pack.ref}`} lead={index === 0} />
            </section>
          ))}
        </>
      )}
    </LinkPage>
  );
}
