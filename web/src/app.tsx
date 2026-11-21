import type { Me } from "@a11-wild/shared";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { Shell } from "@/components/shell";
import { ApiError, api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { Connections } from "@/routes/connections";
import { Home } from "@/routes/home";
import { SignedOut } from "@/routes/signed-out";

type Session = { state: "loading" } | { state: "signed-out"; failed: boolean } | { state: "signed-in"; me: Me };

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(() => {
    let current = true;
    api.me().then(
      (me) => current && setSession({ state: "signed-in", me }),
      (error: unknown) =>
        current && setSession({ state: "signed-out", failed: !(error instanceof ApiError && error.status === 401) }),
    );
    return () => {
      current = false;
    };
  }, []);

  if (session.state === "loading") return <div className="min-h-dvh" aria-busy="true" />;
  if (session.state === "signed-out") return <SignedOut unreachable={session.failed} />;

  return (
    <SessionProvider value={session.me}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="connections" element={<Connections />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}
