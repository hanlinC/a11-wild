import { type KeyboardEvent, type MouseEvent, type ReactNode, type TouchEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Shot {
  url: string;
  alt: string;
}

/** The dark behind a large picture, without its last number: how see-through it is. */
const DARK = "rgba(20,12,7,";
const EASE = "cubic-bezier(.2,.8,.2,1)";
const ROUND = "absolute z-10 grid place-items-center rounded-full bg-[rgba(20,12,7,.62)] leading-none text-white no-underline outline-none focus-visible:ring-2 focus-visible:ring-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[rgba(20,12,7,.85)]";
/** A device with a mouse: it has the arrows, and a click beside the picture closes. A finger swipes and pulls. */
const MOUSE = "(hover:hover) and (pointer:fine)";

/** The one thing to do with the large picture, at its foot. */
export const PILL =
  "rounded-full bg-[rgba(20,12,7,.62)] px-[18px] py-[11px] text-[14px] leading-none font-semibold whitespace-nowrap text-white outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[rgba(20,12,7,.85)]";
/** The same, for the step the page asks for: it is the light one. */
export const PILL_MAIN =
  "rounded-full bg-white px-[18px] py-[11px] text-[14px] leading-none font-semibold whitespace-nowrap text-[#2b1d14] outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/90";

/** What a finger that has moved ten pixels is doing: a pull down is ours, anything else is the browser's (a swipe to the next picture). */
export function pulls(across: number, down: number): boolean {
  return down > 0 && down > Math.abs(across) * 1.2;
}

/** Whether a pull that ends here closes the picture: a long pull, or a short quick one. `speed` is in pixels a millisecond. */
export function letsGo(down: number, speed: number): boolean {
  return down > 90 || (down > 30 && speed > 0.5);
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

/** How far a large picture is drawn in: how many times its fitted size, and how far its middle stands from the middle of the screen. */
export interface Lens {
  scale: number;
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
/** A point between the fingers, measured from the middle of the screen, and how far the fingers are apart. */
export interface Grip {
  x: number;
  y: number;
  apart: number;
}
const FIT: Lens = { scale: 1, x: 0, y: 0 };
/** The closest a picture is drawn: four times its fitted size. */
const CLOSEST = 4;
/** How close a double tap draws it. */
const TAPPED = 2.5;

/**
 * Two fingers on a picture: it grows by how far they moved apart, and the point between them stays under them.
 * It never gets smaller than fitted or closer than four times.
 */
export function pinched(from: Lens, was: Grip, now: Grip): Lens {
  const scale = Math.min(Math.max((from.scale * now.apart) / (was.apart || 1), 1), CLOSEST);
  return { scale, x: now.x - ((was.x - from.x) / from.scale) * scale, y: now.y - ((was.y - from.y) / from.scale) * scale };
}

/** Keeps a picture that is drawn in on the screen: an edge of it never comes inside the screen's edge, and a side that is smaller than the screen stays in the middle. */
export function held(lens: Lens, box: Size, natural: Size): Lens {
  const scale = Math.min(Math.max(lens.scale, 1), CLOSEST);
  if (scale === 1 || box.width <= 0 || box.height <= 0) return FIT;
  const known = natural.width > 0 && natural.height > 0;
  const fit = known ? Math.min(box.width / natural.width, box.height / natural.height) : 1;
  const freeX = Math.max(0, ((known ? natural.width * fit : box.width) * scale - box.width) / 2);
  const freeY = Math.max(0, ((known ? natural.height * fit : box.height) * scale - box.height) / 2);
  return { scale, x: Math.min(Math.max(lens.x, -freeX), freeX), y: Math.min(Math.max(lens.y, -freeY), freeY) };
}

/** A viewer that went away gives its step back a moment later, so a viewer that comes at once takes the step over and no Back runs against a new step. */
let leaving: number | undefined;
/** The step of a viewer that went away is on its way back. It is not a Back of the reader, and a viewer that comes meanwhile takes no step of its own. */
let returning = false;

/**
 * One picture large, over the page it came from, and the whole screen is the picture.
 * A finger swipes to the next one and pulls down to close; a mouse has arrows, and a click beside the picture closes.
 * Two fingers draw the picture in, and so does a double tap; a picture that is drawn in moves with one finger, and does not swipe or close.
 * Esc and the browser's Back close it too, and the page behind stays where it was.
 * It is the browser's own dialog, so the focus goes back to the picture that opened it.
 * What the page can do with the picture goes at its foot, as children: one button, and a line above it at most.
 */
export function Viewer({ shots, at, onAt, onClose, children }: { shots: Shot[]; at: number; onAt: (at: number) => void; onClose: () => void; children?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const inHistory = useRef(false);
  // mode: 0 not yet known, 1 a pull down, 2 the browser's or nobody's, 3 two fingers, 4 one finger on a picture that is drawn in.
  const pull = useRef({ mode: 0, x: 0, y: 0, startAt: 0, lastAt: 0, lastY: 0, speed: 0, closing: false, alone: true });
  const lens = useRef({ now: FIT, from: FIT, was: { x: 0, y: 0, apart: 1 }, tapAt: 0, tapX: 0, tapY: 0, drawn: null as HTMLImageElement | null });
  const many = shots.length > 1;

  // After every draw, not only the first: a viewer that is on the page is always open, and its track stands at the picture the page names.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      node.showModal();
      node.focus();
    }
    const row = track.current;
    if (row && Math.round(row.scrollLeft / (row.clientWidth || 1)) !== at) row.scrollLeft = at * row.clientWidth;
  });

  /** The middle of the screen and its size, and the picture the track stands at. */
  function stage() {
    const row = track.current;
    if (!row) return undefined;
    const box = row.getBoundingClientRect();
    const picture = row.children[Math.round(row.scrollLeft / (row.clientWidth || 1))]?.querySelector("img") ?? null;
    return { row, picture, box, midX: box.left + box.width / 2, midY: box.top + box.height / 2 };
  }
  // Drawn straight on the picture, as the pull down is. While a picture is drawn in, or two fingers are on it, the track does not move.
  function draw(next: Lens, how: { smooth?: boolean; still?: boolean } = {}) {
    const state = lens.current;
    const on = stage();
    if (!on?.picture) return;
    state.now = held(next, on.box, { width: on.picture.naturalWidth, height: on.picture.naturalHeight });
    const { scale, x, y } = state.now;
    if (state.drawn && state.drawn !== on.picture) state.drawn.style.transform = "";
    state.drawn = scale > 1 ? on.picture : null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    on.picture.style.transition = how.smooth && !calm ? `transform .25s ${EASE}` : "none";
    on.picture.style.transform = scale > 1 ? `translate3d(${x}px,${y}px,0) scale(${scale})` : "";
    const still = scale > 1 || how.still === true;
    if (still) on.row.scrollLeft = Math.round(on.row.scrollLeft / (on.row.clientWidth || 1)) * on.row.clientWidth;
    on.row.style.overflowX = still ? "hidden" : "";
  }

  // Another picture, or no viewer: the one that was drawn in is fitted again.
  useEffect(
    () => () => {
      const state = lens.current;
      if (state.drawn) state.drawn.style.transform = "";
      state.drawn = null;
      state.now = FIT;
      if (track.current) track.current.style.overflowX = "";
    },
    [at],
  );

  // One step in the history, so the browser's Back closes the picture and does not leave the page. The step keeps the page's own state.
  useEffect(() => {
    if (leaving !== undefined) {
      window.clearTimeout(leaving);
      leaving = undefined;
      inHistory.current = true;
    } else if (!returning) {
      window.history.pushState({ ...(window.history.state as object | null), viewer: true }, "");
      inHistory.current = true;
    }
    const back = () => {
      if (!inHistory.current) return;
      inHistory.current = false;
      dialog.current?.close();
    };
    const fit = () => {
      const row = track.current;
      const state = lens.current;
      if (state.drawn) state.drawn.style.transform = "";
      state.drawn = null;
      state.now = FIT;
      if (!row) return;
      row.style.overflowX = "";
      row.scrollLeft = Math.round(row.scrollLeft / (row.clientWidth || 1)) * row.clientWidth;
    };
    // Two fingers, and one finger on a picture that is drawn in, are the viewer's: the browser neither scrolls nor zooms the page with them.
    const ours = (event: globalThis.TouchEvent) => {
      if (event.cancelable && (event.touches.length > 1 || lens.current.now.scale > 1)) event.preventDefault();
    };
    const node = dialog.current;
    node?.addEventListener("touchmove", ours, { passive: false });
    window.addEventListener("popstate", back);
    window.addEventListener("resize", fit);
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      node?.removeEventListener("touchmove", ours);
      window.removeEventListener("popstate", back);
      window.removeEventListener("resize", fit);
      root.style.overflow = before;
      // The page took the viewer away itself (a pick, say): its step in the history goes with it.
      if (inHistory.current) {
        inHistory.current = false;
        leaving = window.setTimeout(() => {
          leaving = undefined;
          returning = true;
          window.addEventListener("popstate", () => (returning = false), { once: true });
          window.history.back();
        });
      }
    };
  }, []);

  if (!shots[at]) return null;
  const close = () => (inHistory.current ? window.history.back() : dialog.current?.close());
  const step = (by: number) => (shots[at + by] ? onAt(at + by) : undefined);

  function keys(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || pull.current.closing) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  }
  function scrolled() {
    const row = track.current;
    if (!row) return;
    const now = Math.round(row.scrollLeft / (row.clientWidth || 1));
    if (now !== at && shots[now]) onAt(now);
  }
  function beside(event: MouseEvent<HTMLDivElement>) {
    const picture = event.currentTarget.querySelector("img");
    if (!picture || !window.matchMedia(MOUSE).matches) return;
    if (!onPicture(picture.getBoundingClientRect(), { width: picture.naturalWidth, height: picture.naturalHeight }, event.clientX, event.clientY)) close();
  }

  // The pull down moves the picture with the finger, so it is drawn straight on the nodes and not through a draw of the page.
  function paint(down: number) {
    const node = sheet.current;
    const back = dialog.current;
    if (!node || !back) return;
    const part = Math.min(down / 320, 1);
    node.style.transition = "none";
    back.style.transition = "none";
    node.style.transform = `translateY(${down}px) scale(${1 - part * 0.08})`;
    node.style.opacity = String(1 - part * 0.5);
    back.style.backgroundColor = `${DARK}${1 - part * 0.8})`;
  }
  function settle() {
    const node = sheet.current;
    const back = dialog.current;
    if (!node || !back) return;
    node.style.transition = `transform .3s ${EASE},opacity .3s ${EASE}`;
    back.style.transition = `background-color .3s ${EASE}`;
    node.style.transform = "";
    node.style.opacity = "";
    back.style.backgroundColor = "";
  }
  function fall(down: number) {
    const node = sheet.current;
    const back = dialog.current;
    if (!node || !back || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
    pull.current.closing = true;
    const ease = ".22s cubic-bezier(.4,0,1,1)";
    node.style.transition = `transform ${ease},opacity ${ease}`;
    back.style.transition = "background-color .22s linear";
    node.style.transform = `translateY(${Math.max(down, 0) + Math.round(window.innerHeight * 0.35)}px) scale(.9)`;
    node.style.opacity = "0";
    back.style.backgroundColor = `${DARK}0)`;
    window.setTimeout(close, 230);
  }
  function grip(event: TouchEvent): Grip | undefined {
    const on = stage();
    const [one, two] = [event.touches[0], event.touches[1]];
    if (!on || !one || !two) return undefined;
    return {
      x: (one.clientX + two.clientX) / 2 - on.midX,
      y: (one.clientY + two.clientY) / 2 - on.midY,
      apart: Math.hypot(one.clientX - two.clientX, one.clientY - two.clientY),
    };
  }
  function onTrack(event: TouchEvent): boolean {
    return Array.from(event.touches).every((touch) => touch.target instanceof Node && track.current?.contains(touch.target));
  }
  function touched(event: TouchEvent) {
    const state = pull.current;
    const zoom = lens.current;
    const first = event.touches[0];
    if (state.closing || !first || !onTrack(event)) {
      if (state.mode === 1) settle();
      if (state.mode === 3) draw(zoom.now);
      state.mode = 2;
      return;
    }
    if (event.touches.length > 1) {
      if (state.mode === 1) settle();
      const was = grip(event);
      state.alone = false;
      state.mode = was ? 3 : 2;
      if (!was) return;
      zoom.from = zoom.now;
      zoom.was = was;
      draw(zoom.now, { still: true });
      return;
    }
    Object.assign(state, { mode: zoom.now.scale > 1 ? 4 : 0, x: first.clientX, y: first.clientY, startAt: Date.now(), lastAt: Date.now(), lastY: first.clientY, speed: 0, alone: true });
    zoom.from = zoom.now;
  }
  function moved(event: TouchEvent) {
    const state = pull.current;
    const zoom = lens.current;
    const now = event.touches[0];
    if (state.mode === 3) {
      const to = grip(event);
      if (to) draw(pinched(zoom.from, zoom.was, to), { still: true });
      return;
    }
    if (state.mode === 4 && now) {
      draw({ scale: zoom.from.scale, x: zoom.from.x + now.clientX - state.x, y: zoom.from.y + now.clientY - state.y });
      return;
    }
    if (state.mode === 2 || event.touches.length !== 1 || !now) {
      if (state.mode === 1) settle();
      state.mode = 2;
      return;
    }
    const across = now.clientX - state.x;
    const down = now.clientY - state.y;
    if (state.mode === 0) {
      if (Math.abs(across) < 10 && Math.abs(down) < 10) return;
      state.mode = pulls(across, down) ? 1 : 2;
    }
    if (state.mode !== 1) return;
    const time = Date.now();
    if (time - state.lastAt >= 8) {
      state.speed = (now.clientY - state.lastY) / (time - state.lastAt);
      state.lastAt = time;
      state.lastY = now.clientY;
    }
    paint(Math.max(down, 0));
  }
  /** A second quick tap at the same place draws the picture in there, or fits it again. */
  function tapped(x: number, y: number) {
    const zoom = lens.current;
    const on = stage();
    const again = Date.now() - zoom.tapAt < 300 && Math.hypot(x - zoom.tapX, y - zoom.tapY) < 30;
    Object.assign(zoom, again ? { tapAt: 0 } : { tapAt: Date.now(), tapX: x, tapY: y });
    if (!again || !on) return;
    const point = { x: x - on.midX, y: y - on.midY, apart: 1 };
    draw(zoom.now.scale > 1 ? FIT : pinched(FIT, point, { ...point, apart: TAPPED }), { smooth: true });
  }
  function lifted(event: TouchEvent) {
    const state = pull.current;
    const zoom = lens.current;
    const left = event.touches[0];
    const was = state.mode;
    if (was === 3) {
      const still = grip(event);
      if (still) {
        // A third finger went: the two that stay go on from where the picture is.
        zoom.from = zoom.now;
        zoom.was = still;
        return;
      }
      draw(zoom.now);
      // One finger stays: it moves a picture that is drawn in, and does nothing to one that is fitted.
      state.mode = left ? (zoom.now.scale > 1 ? 4 : 2) : 0;
      if (left) Object.assign(state, { x: left.clientX, y: left.clientY });
      zoom.from = zoom.now;
      return;
    }
    if (left) return;
    state.mode = 0;
    const end = event.changedTouches[0];
    const still = end ? Math.hypot(end.clientX - state.x, end.clientY - state.y) < 10 : false;
    if (event.type === "touchend" && end && state.alone && still && (was === 0 || was === 4) && Date.now() - state.startAt < 300) tapped(end.clientX, end.clientY);
    if (was !== 1) return;
    const down = (end?.clientY ?? state.y) - state.y;
    const speed = Date.now() - state.lastAt > 100 ? 0 : state.speed;
    if (event.type === "touchend" && letsGo(down, speed)) fall(down);
    else settle();
  }

  return (
    <dialog
      ref={dialog}
      aria-label={many ? `Picture ${at + 1} of ${shots.length}, large` : "Picture, large"}
      tabIndex={-1}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={keys}
      onTouchStart={touched}
      onTouchMove={moved}
      onTouchEnd={lifted}
      onTouchCancel={lifted}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden rounded-none bg-[#140c07] p-0 text-white outline-none backdrop:bg-transparent motion-safe:animate-[viewer-in_.2s]"
    >
      <div ref={sheet} className="relative size-full">
        <div ref={track} onScroll={scrolled} className="flex h-full touch-pan-x snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shots.map((shot, index) => (
            <div key={`${shot.url}-${index}`} onClick={beside} className="relative h-full flex-[0_0_100%] snap-center snap-always overflow-hidden">
              <img src={shot.url} alt={shot.alt} referrerPolicy="no-referrer" loading={index === at ? undefined : "lazy"} className="pointer-events-none absolute inset-0 size-full object-contain" />
            </div>
          ))}
        </div>
        {many ? (
          <span aria-live="polite" className="absolute top-5 left-4 z-10 rounded-full bg-[rgba(20,12,7,.62)] px-3 py-1.5 text-[14px] leading-none font-semibold">
            {at + 1} / {shots.length}
          </span>
        ) : null}
        <button type="button" aria-label="Close" onClick={close} className={`${ROUND} top-3 right-3 size-11 text-[26px]`}>
          &times;
        </button>
        {shots[at - 1] ? (
          <button type="button" aria-label="Previous picture" onClick={() => step(-1)} className={`${ROUND} top-1/2 left-4 -mt-6 hidden size-12 text-[29px] [@media(hover:hover)_and_(pointer:fine)]:grid`}>
            &#8249;
          </button>
        ) : null}
        {shots[at + 1] ? (
          <button type="button" aria-label="Next picture" onClick={() => step(1)} className={`${ROUND} top-1/2 right-4 -mt-6 hidden size-12 text-[29px] [@media(hover:hover)_and_(pointer:fine)]:grid`}>
            &#8250;
          </button>
        ) : null}
        {children ? (
          <div className="viewer-foot absolute inset-x-3 bottom-4 z-10 mx-auto grid w-fit max-w-[min(34rem,calc(100vw-1.5rem))] justify-items-center gap-2 text-center">{children}</div>
        ) : null}
      </div>
    </dialog>
  );
}

/** What a page says about the large picture, above its button: a line or two on the dark, cut when it is longer. */
export const NOTE = "line-clamp-2 rounded-lg bg-[rgba(20,12,7,.62)] px-3 py-1.5 text-[13px] leading-[18px] text-white";

/** A picture that opens large over the page, not in a new tab. Its mark stands at the picture's lower right corner. */
export const ZOOM = "relative block w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The mark on a picture that opens large: two arrows that point apart. */
export function ZoomMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute right-2.5 bottom-2.5 grid size-[34px] place-items-center rounded-full bg-white/90">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2b1d14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2L9 7M2 14l5-5" />
      </svg>
    </span>
  );
}

/** One picture of a page that opens large by itself. The whole screen is the picture; `note` is the one thing the page says about it there, cut at two lines. */
export function Zoom({ url, alt, className, note }: { url: string; alt: string; className: string; note?: string }) {
  const [large, setLarge] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setLarge(true)} title="Look at it large" className={ZOOM}>
        <img src={url} alt={alt} className={className} />
        <ZoomMark />
      </button>
      {large ? (
        <Viewer shots={[{ url, alt }]} at={0} onAt={() => undefined} onClose={() => setLarge(false)}>
          {note ? (
            <p className={NOTE} title={note}>
              {note}
            </p>
          ) : null}
        </Viewer>
      ) : null}
    </>
  );
}
