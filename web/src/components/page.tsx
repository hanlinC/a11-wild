import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function PageHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="mb-8 max-w-2xl">
      <h1 className="text-display font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">{lead}</p>
    </header>
  );
}

export function Section({ title, count, mark, children }: { title: string; count?: number; mark?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-baseline gap-2 text-subtitle font-medium">
          {title}
          {count === undefined ? null : <span className="text-caption text-muted-foreground">{count}</span>}
        </h2>
        {mark}
      </div>
      {children}
    </section>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-card p-5", className)}>{children}</div>;
}

/** Says plainly that nothing is here yet, and what will make it appear. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-body text-muted-foreground">
      {children}
    </div>
  );
}

/** How many wait: a filled mark the eye finds first. It is not shown at zero. */
export function Waiting({ count, className }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-micro font-medium text-background tabular-nums", className)}>
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> waiting for you</span>
    </span>
  );
}

/**
 * One thing that waits for the owner: what it is about, what is asked, and the one place to do it.
 * With no `action` the line says where the answer is given, and `to` is a quiet link.
 */
export function Ask({ about, ask, to, action, where }: { about: ReactNode; ask: ReactNode; to: string; action?: string; where?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-5 py-4">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-subtitle font-medium">{ask}</p>
        <p className="mt-0.5 text-body text-muted-foreground">{about}</p>
      </div>
      {action ? (
        <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-body font-medium text-background transition-opacity hover:opacity-85">
          {action}
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      ) : (
        <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-caption text-muted-foreground">
          {where}
          <Link to={to} className="underline underline-offset-4 hover:text-foreground">
            See the batch
          </Link>
        </span>
      )}
    </li>
  );
}

const STEP_LABEL = { you: "Asked of you", agent: "In work", nobody: "Nothing is asked of you" } as const;

/**
 * The first thing under a page's header: the one thing asked of the reader, or who acts next when nothing is.
 * `left` is how much of the ask is still open, in a few words.
 */
export function Step({ who, left, children }: { who: keyof typeof STEP_LABEL; left?: string; children: ReactNode }) {
  return (
    <div role="status" className={cn("mb-8 rounded-xl border px-5 py-4", who === "you" ? "border-foreground bg-card" : "border-border")}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <span className={cn(who === "you" && "font-medium text-foreground")}>{STEP_LABEL[who]}</span>
        {left ? <span className="tabular-nums">{left}</span> : null}
      </p>
      <p className={cn("mt-1", who === "you" ? "text-subtitle font-medium" : "text-body text-muted-foreground")}>{children}</p>
    </div>
  );
}

/** A part of a page that is kept out of the way: its name and its size are shown, the rest opens at a click. */
export function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="mt-3 rounded-xl border border-border first:mt-0">
      <h2>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)} className="flex w-full items-center gap-2 rounded-xl px-5 py-3 text-left text-body text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="font-medium">{title}</span>
          {count === undefined ? null : <span className="text-caption tabular-nums">{count}</span>}
        </button>
      </h2>
      {open ? (
        <div id={id} className="border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}
