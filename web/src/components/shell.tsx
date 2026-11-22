import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Studio" },
  { to: "/brands", label: "Brands" },
  { to: "/outreach", label: "Outreach", ownerOnly: true },
  { to: "/packs", label: "Packs" },
  { to: "/clients", label: "Clients", ownerOnly: true },
  { to: "/taste", label: "Taste" },
  { to: "/calibration", label: "Calibration" },
  { to: "/spend", label: "Spend" },
  { to: "/connections", label: "Connections" },
] as const satisfies readonly { to: string; label: string; ownerOnly?: true }[];

/** The frame around every signed-in page: wordmark, the sections, who is signed in. */
export function Shell() {
  const me = useMe();
  const [leaving, setLeaving] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // On a phone the bar may hold the open section out of sight, after a reload for one: bring it in.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  async function signOut() {
    setLeaving(true);
    try {
      const { redirect } = await api.logout();
      window.location.assign(redirect);
    } catch {
      window.location.assign("/");
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-(--z-sticky) border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5 sm:gap-6">
          <span className="shrink-0 text-title font-semibold tracking-tight">
            a11 <span className="text-muted-foreground">wild</span>
          </span>
          {/* On a phone the sections scroll sideways inside the bar; the page itself never does. */}
          <nav ref={nav} aria-label="Sections" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {NAV.filter((item) => !("ownerOnly" in item) || me.role === "owner").map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "shrink-0 rounded-md px-2.5 py-1.5 text-body whitespace-nowrap transition-colors",
                    isActive ? "bg-(--tint) text-foreground" : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            {/* A long address is cut, never the sections: the bar gives the sections its room first. */}
            <span className="hidden max-w-56 truncate text-caption text-muted-foreground lg:inline" title={`${me.email} · ${me.role}`}>
              {me.email} · {me.role}
            </span>
            <Button variant="tertiary" size="compact" loading={leaving} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <Outlet />
      </main>
    </div>
  );
}
