import type { Me } from "@a11-wild/shared";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { Shell } from "@/components/shell";
import { ApiError, api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { Board } from "@/routes/board";
import { Brand } from "@/routes/brand";
import { Brands } from "@/routes/brands";
import { Calibration } from "@/routes/calibration";
import { Concepts } from "@/routes/concepts";
import { Connections } from "@/routes/connections";
import { Home } from "@/routes/home";
import { Pack } from "@/routes/pack";
import { Packs } from "@/routes/packs";
import { SignedOut } from "@/routes/signed-out";
import { Spend } from "@/routes/spend";
import { Taste } from "@/routes/taste";

type Session = { state: "loading" } | { state: "signed-out"; failed: boolean } | { state: "signed-in"; me: Me };

/** A client's pack opens with no sign-in: its link is the key. Everything else is the dashboard. */
export function App() {
  return (
    <Routes>
      <Route path="c/:token" element={<Pack />} />
      <Route path="*" element={<Dashboard />} />
    </Routes>
  );
}

function Dashboard() {
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
          <Route path="brands" element={<Brands />} />
          <Route path="brands/:brandId" element={<Brand />} />
          <Route path="batches/:batchId" element={<Board />} />
          <Route path="batches/:batchId/concepts" element={<Concepts />} />
          <Route path="taste" element={<Taste />} />
          <Route path="packs" element={<Packs />} />
          <Route path="calibration" element={<Calibration />} />
          <Route path="spend" element={<Spend />} />
          <Route path="connections" element={<Connections />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}
