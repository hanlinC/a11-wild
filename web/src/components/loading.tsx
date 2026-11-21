import { Banner, BannerTitle } from "@/components/ui/banner";

/** What a page shows before its data is there: the failure in words, or that it is loading. */
export function Loading({ error }: { error: string | undefined }) {
  if (error) {
    return (
      <Banner status="error">
        <BannerTitle>{error}</BannerTitle>
      </Banner>
    );
  }
  return (
    <p className="text-body text-muted-foreground" aria-busy="true">
      Loading
    </p>
  );
}

/** A link to another site. It opens in a new tab, and the new page gets no handle on this one. */
export function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4 hover:text-foreground">
      {children}
    </a>
  );
}
