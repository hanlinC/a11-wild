import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="mb-8 max-w-2xl">
      <h1 className="text-display font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">{lead}</p>
    </header>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="mb-3 flex items-baseline gap-2 text-subtitle font-medium">
        {title}
        {count === undefined ? null : <span className="text-caption text-muted-foreground">{count}</span>}
      </h2>
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
