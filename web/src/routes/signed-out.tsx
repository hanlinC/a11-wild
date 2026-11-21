import { Banner, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

const REASONS: Record<string, string> = {
  denied: "That account is not on the invitation list. Ask the owner to invite you.",
  failed: "Sign-in did not finish. Try again.",
};

/** The only page a visitor without a session sees. It says nothing about the studio. */
export function SignedOut({ unreachable = false }: { unreachable?: boolean }) {
  const reason = new URLSearchParams(window.location.search).get("reason") ?? "";
  const message = unreachable ? "The studio did not answer. Try again in a moment." : REASONS[reason];

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-sm">
        <h1 className="text-display font-semibold tracking-tight">
          a11 <span className="text-muted-foreground">wild</span>
        </h1>
        <p className="mt-2 text-body text-muted-foreground">A private studio. Sign in with the account you were invited with.</p>
        {message ? (
          <Banner status={unreachable ? "warning" : "error"} className="mt-6">
            <BannerTitle>{message}</BannerTitle>
          </Banner>
        ) : null}
        <Button asChild className="mt-6 w-full">
          <a href="/auth/login">Sign in</a>
        </Button>
      </div>
    </main>
  );
}
