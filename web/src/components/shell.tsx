import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Studio" },
  { to: "/brands", label: "Brands" },
  { to: "/taste", label: "Taste" },
  { to: "/spend", label: "Spend" },
  { to: "/connections", label: "Connections" },
] as const;

/** The frame around every signed-in page: wordmark, the sections, who is signed in. */
export function Shell() {
  const me = useMe();
  const [leaving, setLeaving] = useState(false);

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
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-5">
          <span className="text-title font-semibold tracking-tight">
            a11 <span className="text-muted-foreground">wild</span>
          </span>
          <nav aria-label="Sections" className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 text-body transition-colors",
                    isActive ? "bg-(--tint) text-foreground" : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-caption text-muted-foreground sm:inline">
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
