import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; ownerOnly?: true };
/** The sections of every day. They stay in the bar. */
const MAIN: readonly Item[] = [
  { to: "/", label: "Studio" },
  { to: "/brands", label: "Brands" },
  { to: "/outreach", label: "Outreach", ownerOnly: true },
  { to: "/packs", label: "Packs" },
  { to: "/clients", label: "Clients", ownerOnly: true },
];
/** The sections opened now and then. They sit behind "More", so the bar is never cut. */
const MORE: readonly Item[] = [
  { to: "/taste", label: "Taste" },
  { to: "/calibration", label: "Calibration" },
  { to: "/spend", label: "Spend" },
  { to: "/connections", label: "Connections" },
];
const isOpen = (item: Item, pathname: string) => pathname === item.to || pathname.startsWith(`${item.to}/`);

const LINK = "rounded-md px-2.5 py-1.5 text-body whitespace-nowrap transition-colors";
const ON = "bg-(--tint) text-foreground";
const OFF = "text-muted-foreground hover:text-foreground";

/** The frame around every signed-in page: wordmark, the sections, who is signed in. */
export function Shell() {
  const me = useMe();
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const mine = (item: Item) => !item.ownerOnly || me.role === "owner";
  const here = MORE.filter(mine).find((item) => isOpen(item, pathname));

  // The list closes when a section opens, and at a click or a focus anywhere outside it.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!more.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

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
          <nav aria-label="Sections" className="flex min-w-0 flex-1 items-center gap-1">
            {/* On a phone the sections of every day scroll sideways inside the bar; the page itself never does. */}
            <div ref={nav} className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              {MAIN.filter(mine).map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => cn(LINK, "shrink-0", isActive ? ON : OFF)}>
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div
              ref={more}
              className="relative shrink-0"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !open) return;
                setOpen(false);
                more.current?.querySelector("button")?.focus();
              }}
            >
              {/* The button carries the name of the open section when that section is one of these, so the bar always says where you are. */}
              <button type="button" aria-expanded={open} aria-controls="more-sections" onClick={() => setOpen((was) => !was)} className={cn(LINK, "flex items-center gap-1", here ? ON : OFF)}>
                {here ? here.label : "More"}
                <span className="sr-only">{here ? ", more sections" : ", other sections"}</span>
                <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
              </button>
              {open ? (
                <ul id="more-sections" className="absolute right-0 top-full z-(--z-popover) mt-2 grid w-48 gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg sm:right-auto sm:left-0">
                  {MORE.filter(mine).map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} className={({ isActive }) => cn(LINK, "block", isActive ? ON : OFF)}>
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                  {/* On a phone the bar has no room for the sign-out button, so it is here. */}
                  <li className="mt-1 border-t border-border pt-1 sm:hidden">
                    <button type="button" disabled={leaving} onClick={signOut} className={cn(LINK, OFF, "block w-full text-left")}>
                      Sign out
                    </button>
                  </li>
                </ul>
              ) : null}
            </div>
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            {/* A long address is cut, never the sections: the bar gives the sections its room first. */}
            <span className="hidden max-w-56 truncate text-caption text-muted-foreground lg:inline" title={`${me.email} · ${me.role}`}>
              {me.email} · {me.role}
            </span>
            <Button variant="tertiary" size="compact" loading={leaving} onClick={signOut} className="max-sm:hidden">
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
