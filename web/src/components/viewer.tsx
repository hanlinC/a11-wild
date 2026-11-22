import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type TouchEvent, useEffect, useRef, useState } from "react";

export interface Shot {
  url: string;
  alt: string;
}

const ROUND = "grid size-11 place-items-center rounded-full bg-black/50 text-white outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white";
/** A sideways move of the finger this long, in pixels, is a swipe to the next picture. */
const SWIPE = 48;
/** A downward pull this long, in pixels, closes the picture. */
const PULL = 96;

/** What one finger did between touch and lift: a pull down closes, a swipe steps, anything shorter is nothing. */
export function gesture(across: number, down: number): "close" | "next" | "previous" | undefined {
  if (down >= PULL && down > Math.abs(across)) return "close";
  if (Math.abs(across) >= SWIPE && Math.abs(across) > Math.abs(down)) return across < 0 ? "next" : "previous";
  return undefined;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Whether a point is on a picture that is drawn whole and centred in its box. The box is larger than the picture on two sides.
 * A picture that has not loaded yet has no size: the point counts as on it, so a click then closes nothing.
 */
export function onPicture(box: Box, natural: { width: number; height: number }, x: number, y: number): boolean {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return true;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const left = box.left + (box.width - width) / 2;
  const top = box.top + (box.height - height) / 2;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

/**
 * One picture large, over the page it came from: the owner looks, steps to the next one and stays where he was.
 * It is the browser's own dialog, so Esc closes it and the focus goes back to the picture he opened.
 * The pictures are the ones the page already shows, so each opens from the browser's cache.
 */
export function Viewer({ shots, at, onAt, onClose, children }: { shots: Shot[]; at: number; onAt: (at: number) => void; onClose: () => void; children?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);
  const [pull, setPull] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const shot = shots[at];
  const many = shots.length > 1;

  // After every draw, not only the first: a viewer that is on the page is always open.
  // The focus goes to the dialog and not to its first button, so no button shows a focus ring until the Tab key is used.
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      node.showModal();
      node.focus();
    }
  });
  // A picture that is pinched larger is moved with one finger: then a swipe or a pull is not ours.
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const read = () => setZoomed(view.scale > 1.01);
    read();
    view.addEventListener("resize", read);
    return () => view.removeEventListener("resize", read);
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
  function touched(event: TouchEvent) {
    const first = event.touches[0];
    touch.current = first && event.touches.length === 1 && !zoomed ? { x: first.clientX, y: first.clientY } : undefined;
    setPull(0);
  }
  function moved(event: TouchEvent) {
    const from = touch.current;
    const now = event.touches[0];
    if (!from || !now) return;
    const down = now.clientY - from.y;
    setPull(down > 0 && down > Math.abs(now.clientX - from.x) ? down : 0);
  }
  function lifted(event: TouchEvent) {
    const from = touch.current;
    const to = event.changedTouches[0];
    touch.current = undefined;
    setPull(0);
    if (!from || !to) return;
    const did = gesture(to.clientX - from.x, to.clientY - from.y);
    if (did === "close") close();
    else if (did && many) step(did === "next" ? 1 : -1);
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Picture, large"
      tabIndex={-1}
      onClose={onClose}
      onKeyDown={keys}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-foreground outline-none backdrop:bg-black/85"
    >
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-1">
        {/* A click beside the picture closes it; the key for that is Esc; on a phone a pull down closes it. */}
        {/* One finger is ours and two fingers pinch the page larger, so a pull down never reloads the page. */}
        <div
          className={zoomed ? "relative min-h-0" : "relative min-h-0 touch-pinch-zoom"}
          onClick={(event) => (event.target === event.currentTarget ? close() : undefined)}
          onTouchStart={touched}
          onTouchMove={moved}
          onTouchEnd={lifted}
          onTouchCancel={() => ((touch.current = undefined), setPull(0))}
        >
          {/* The box has its size from the window alone, and the picture fills it: a picture that loads late or is small opens as large as any other. */}
          <div
            className={pull ? "absolute inset-3 sm:inset-6" : "absolute inset-3 transition-transform duration-150 sm:inset-6"}
            style={pull ? { transform: `translateY(${pull}px)`, opacity: Math.max(0.4, 1 - pull / 400) } : undefined}
          >
            <img
              src={shot.url}
              alt={shot.alt}
              referrerPolicy="no-referrer"
              className="size-full object-contain"
              onClick={(event) => (onPicture(event.currentTarget.getBoundingClientRect(), { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }, event.clientX, event.clientY) ? undefined : close())}
            />
          </div>
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
