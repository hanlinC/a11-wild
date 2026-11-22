import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type TouchEvent, useEffect, useRef, useState } from "react";

export interface Shot {
  url: string;
  alt: string;
}

const ROUND = "grid size-11 place-items-center rounded-full bg-black/50 text-white outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white";
/** A sideways move of the finger this long, in pixels, is a swipe to the next picture. */
const SWIPE = 48;

/**
 * One picture large, over the page it came from: the owner looks, steps to the next one and stays where he was.
 * It is the browser's own dialog, so Esc closes it and the focus goes back to the picture he opened.
 * The pictures are the ones the page already shows, so each opens from the browser's cache.
 */
export function Viewer({ shots, at, onAt, onClose, children }: { shots: Shot[]; at: number; onAt: (at: number) => void; onClose: () => void; children?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);
  const shot = shots[at];
  const many = shots.length > 1;

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  if (!shot) return null;
  // The dialog closes itself, so the focus goes back to the picture he opened; its close event tells the page.
  const close = () => dialog.current?.close();
  const step = (by: number) => onAt((at + by + shots.length) % shots.length);

  function keys(event: KeyboardEvent) {
    if (!many || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  }
  function swiped(event: TouchEvent) {
    const from = touch.current;
    const to = event.changedTouches[0];
    touch.current = undefined;
    if (!many || !from || !to) return;
    const across = to.clientX - from.x;
    if (Math.abs(across) >= SWIPE && Math.abs(across) > Math.abs(to.clientY - from.y)) step(across < 0 ? 1 : -1);
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Picture, large"
      onClose={onClose}
      onKeyDown={keys}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-foreground backdrop:bg-black/85"
    >
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-1">
        {/* A click beside the picture closes it; the key for that is Esc. */}
        <div
          className="relative flex min-h-0 items-center justify-center p-3 sm:p-6"
          onClick={(event) => (event.target === event.currentTarget ? close() : undefined)}
          onTouchStart={(event) => {
            const first = event.touches[0];
            touch.current = first ? { x: first.clientX, y: first.clientY } : undefined;
          }}
          onTouchEnd={swiped}
        >
          <img src={shot.url} alt={shot.alt} className="max-h-full max-w-full rounded-lg object-contain" />
          <button type="button" aria-label="Close" onClick={close} className={`${ROUND} absolute top-3 right-3`}>
            <X className="size-5" aria-hidden />
          </button>
          {many ? (
            <>
              <button type="button" aria-label="Previous picture" onClick={() => step(-1)} className={`${ROUND} absolute top-1/2 left-3 -translate-y-1/2`}>
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button type="button" aria-label="Next picture" onClick={() => step(1)} className={`${ROUND} absolute top-1/2 right-3 -translate-y-1/2`}>
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </>
          ) : null}
        </div>
        {children || many ? (
          <div className="grid max-h-[40dvh] content-start gap-3 overflow-y-auto bg-background p-4 lg:max-h-none lg:p-6">
            {many ? (
              <p className="text-caption text-muted-foreground" aria-live="polite">
                {at + 1} of {shots.length}
              </p>
            ) : null}
            {children}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/** A picture that opens large over the page, not in a new tab. */
export const ZOOM = "block w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One picture of a page that opens large by itself: what the page says about it goes beside it as children. */
export function Zoom({ url, alt, className, children }: { url: string; alt: string; className: string; children?: ReactNode }) {
  const [large, setLarge] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setLarge(true)} title="Look at it large" className={ZOOM}>
        <img src={url} alt={alt} className={className} />
      </button>
      {large ? (
        <Viewer shots={[{ url, alt }]} at={0} onAt={() => undefined} onClose={() => setLarge(false)}>
          {children}
        </Viewer>
      ) : null}
    </>
  );
}
