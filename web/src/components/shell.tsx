import type { AttentionCounts } from "@a11-wild/shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Waiting } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import { AttentionProvider, type AttentionState } from "@/lib/attention";
import { useMe } from "@/lib/session";
import { useWide } from "@/lib/use-wide";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; ownerOnly?: true; count?: keyof AttentionCounts };
/** The sections of every day. They stay in the bar when the window has room. */
const MAIN: readonly Item[] = [
  { to: "/", label: "Studio", count: "studio" },
  { to: "/brands", label: "Brands" },
  { to: "/outreach", label: "Outreach", ownerOnly: true, count: "outreach" },
  { to: "/packs", label: "Packs" },
  { to: "/clients", label: "Clients", ownerOnly: true, count: "clients" },
];
/** The sections opened now and then. They sit behind "More", so the bar is never cut. */
const MORE: readonly Item[] = [
  { to: "/taste", label: "Taste", count: "taste" },
  { to: "/calibration", label: "Calibration" },
  { to: "/spend", label: "Spend" },
  { to: "/connections", label: "Connections", count: "connections" },
];
const isOpen = (item: Item, pathname: string) => (item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`));

const LINK = "rounded-md px-2.5 py-1.5 text-body whitespace-nowrap transition-colors";
const ON = "bg-(--tint) text-foreground";
const OFF = "text-muted-foreground hover:text-foreground";

/** The frame around every signed-in page: wordmark, the sections with what waits in each, who is signed in. */
export function Shell() {
  const me = useMe();
  const wide = useWide();
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [attention, setAttention] = useState<AttentionState>({ value: undefined, error: undefined });
  const [buildId, setBuildId] = useState<string>();
  const menu = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const mine = (item: Item) => !item.ownerOnly || me.role === "owner";
  // With room, the bar holds the sections of every day and the list holds the others. On a phone the list holds them all.
  const listed = (wide ? MORE : [...MAIN, ...MORE]).filter(mine);
  const here = listed.find((item) => isOpen(item, pathname));
  const counts = attention.value?.counts;
  // The start page lists all that waits, so its number is the sum. Each other section has its own part.
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0) : undefined;
  const countOf = (item: Item) => (item.count === "studio" ? total : item.count ? counts?.[item.count] : undefined);
  const behind = wide ? listed.reduce((sum, item) => sum + (countOf(item) ?? 0), 0) : total;

  // What waits is read again at each page, so a count never outlives the thing it counted.
  useEffect(() => {
    let current = true;
    api.attention().then(
      (value) => current && setAttention({ value, error: undefined }),
      (cause: unknown) => current && setAttention((was) => ({ value: was.value, error: describeError(cause) })),
    );
    return () => {
      current = false;
    };
  }, [pathname]);

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

  // The list closes when a section opens, and at a click or a focus anywhere outside it.
  useEffect(() => setOpen(false), [pathname, wide]);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

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
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-(--z-sticky) border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5 md:gap-6">
          <span className="shrink-0 text-title font-semibold tracking-tight">
            a11 <span className="text-muted-foreground">wild</span>
          </span>
          <nav aria-label="Sections" className="flex min-w-0 flex-1 items-center gap-1">
            {wide
              ? MAIN.filter(mine).map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => cn(LINK, "flex shrink-0 items-center gap-1.5", isActive ? ON : OFF)}>
                    {item.label}
                    <Waiting count={countOf(item)} />
                  </NavLink>
                ))
              : null}
            <div
              ref={menu}
              className={cn("relative shrink-0", !wide && "ml-auto")}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !open) return;
                setOpen(false);
                menu.current?.querySelector("button")?.focus();
              }}
            >
              {/* The button carries the name of the open section when that section is in its list, so the bar always says where you are. */}
              <button type="button" aria-expanded={open} aria-controls="more-sections" onClick={() => setOpen((was) => !was)} className={cn(LINK, "flex items-center gap-1.5", here ? ON : OFF)}>
                {here ? here.label : wide ? "More" : "Menu"}
                <span className="sr-only">{here ? ", more sections" : wide ? ", other sections" : ", all sections"}</span>
                {open ? null : <Waiting count={behind} />}
                <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
              </button>
              {open ? (
                <ul id="more-sections" className={cn("absolute top-full z-(--z-popover) mt-2 grid gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg", wide ? "left-0 w-48" : "right-0 w-60")}>
                  {listed.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => cn(LINK, "flex items-center justify-between gap-3", !wide && "py-2.5", isActive ? ON : OFF)}>
                        {item.label}
                        <Waiting count={countOf(item)} />
                      </NavLink>
                    </li>
                  ))}
                  {/* On a phone the bar has no room for the sign-out button, so it is here. */}
                  {wide ? null : (
                    <li className="mt-1 border-t border-border pt-1">
                      <p className="truncate px-2.5 pt-1.5 text-caption text-muted-foreground" title={me.email}>
                        {me.email} · {me.role}
                      </p>
                      <button type="button" disabled={leaving} onClick={signOut} className={cn(LINK, OFF, "block w-full py-2.5 text-left")}>
                        Sign out
                      </button>
                    </li>
                  )}
                </ul>
              ) : null}
            </div>
          </nav>
          {wide ? (
            <div className="flex shrink-0 items-center gap-3">
              {/* A long address is cut, never the sections: the bar gives the sections its room first. */}
              <span className="hidden max-w-56 truncate text-caption text-muted-foreground lg:inline" title={`${me.email} · ${me.role}`}>
                {me.email} · {me.role}
              </span>
              <Button variant="tertiary" size="compact" loading={leaving} onClick={signOut}>
                Sign out
              </Button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <AttentionProvider value={attention}>
          <Outlet />
        </AttentionProvider>
      </main>
      <footer className="mx-auto w-full max-w-5xl px-5 pb-8 text-micro text-muted-foreground">
        {buildId ? `Build ${buildId}` : null}
      </footer>
    </div>
  );
}
