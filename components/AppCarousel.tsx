"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Horizontal, snap-scrolling track for app cards, with arrows and a gentle
 * autoplay.
 *
 * Client-side only for the controls — the cards themselves are passed in as
 * `children` and stay server-rendered, so every card is real HTML with a real
 * href in the initial response. That matters more than usual here: this sits
 * on the homepage and is a big share of the site's internal linking.
 *
 * No carousel library — the project has none, and native overflow scrolling
 * with CSS snap points does the whole job, including iOS momentum, for free.
 */

/** How long a card sits still before autoplay advances. */
const AUTOPLAY_MS = 4500;

/**
 * One card's width per breakpoint, chosen so a partial card always peeks in
 * at the right edge: that overhang is the only thing telling a touch user
 * there is more to swipe to.
 *
 * 1 + peek on phones, 2 + peek on large phones, 3 from tablet portrait up,
 * 5 on desktop — the last matching the `xl:grid-cols-5` rhythm the homepage
 * already uses. The 3-card band starts at `md` rather than `lg` so a 768px
 * tablet in portrait gets three across rather than two.
 *
 * The two exact-fit bands subtract the gaps rather than guessing a
 * percentage: three 31.5% cards plus two 20px gaps came to 706px in a 705px
 * track, one pixel over, and the third card wrapped to a peek. `calc` makes
 * the arithmetic exact at any width. The 1- and 2-card bands stay as
 * percentages because there the overhang is the point.
 *
 * `min-w-0` is load-bearing, not tidiness: a flex item defaults to
 * `min-width: auto`, which floors it at its min-content width. Without it the
 * cards ignored the smaller bases and sat at 328px, so desktop showed three
 * across instead of five.
 */
export const CAROUSEL_ITEM =
  "min-w-0 shrink-0 snap-start basis-[80%] sm:basis-[46%] md:basis-[calc((100%-2.5rem)/3)] xl:basis-[calc((100%-5rem)/5)]";

/**
 * Tracks `prefers-reduced-motion` live, so turning it on mid-session stops
 * autoplay without a reload.
 *
 * `useSyncExternalStore` rather than an effect: reading a media query in an
 * effect and calling setState is exactly the cascading-render pattern the
 * lint rules reject, and this variant is server-safe by construction — the
 * third argument is the snapshot used during SSR, where `window` does not
 * exist.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export default function AppCarousel({
  label,
  children,
}: {
  /** Names the scrollable region for screen readers. */
  label: string;
  children: React.ReactNode;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /** Hover or keyboard focus anywhere inside the carousel holds autoplay. */
  const [held, setHeld] = useState(false);
  /**
   * Bumped by anything that counts as the reader taking over — an arrow click,
   * a touch. Changing it tears the timer down and builds a new one, so the
   * next automatic move is a full interval away rather than whatever was left
   * on the clock.
   */
  const [restart, setRestart] = useState(0);
  const reduced = usePrefersReducedMotion();

  const sync = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // 1px of slack: sub-pixel layout means scrollLeft rarely lands on exactly 0
    // or exactly scrollWidth - clientWidth.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;

    // Deferred rather than called straight from the effect body, so the first
    // measurement happens after paint instead of forcing a synchronous
    // re-render during commit.
    const first = requestAnimationFrame(sync);

    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(first);
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  const page = useCallback((direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;

    const items = Array.from(el.children) as HTMLElement[];
    if (items.length === 0) return;

    // Just under a full viewport, so the card that was half-visible at the
    // edge lands fully in view rather than being skipped past.
    const wanted = el.scrollLeft + direction * el.clientWidth * 0.9;

    /*
     * Land on a card edge rather than an arbitrary offset, so a move never
     * leaves a column of half-cards: with `scroll-snap-type: x mandatory` the
     * browser would snap afterwards anyway, and picking the snap point
     * ourselves means the scroll ends where the snap was going to put it
     * instead of visibly settling twice.
     */
    const left = el.getBoundingClientRect().left;
    const target = items.reduce((best, item) => {
      const at = el.scrollLeft + item.getBoundingClientRect().left - left;
      const bestAt = el.scrollLeft + best.getBoundingClientRect().left - left;
      return Math.abs(at - wanted) < Math.abs(bestAt - wanted) ? item : best;
    }, items[0]);

    el.scrollTo({
      left: el.scrollLeft + target.getBoundingClientRect().left - left,
      behavior: "smooth",
    });
  }, []);

  /** Arrow presses move the track and put a full interval back on the clock. */
  const nudge = useCallback(
    (direction: 1 | -1) => {
      page(direction);
      setRestart((n) => n + 1);
    },
    [page],
  );

  useEffect(() => {
    // Reduced motion switches autoplay off entirely rather than making it
    // instant: the objection to movement is the movement, not its easing.
    if (reduced || held) return;

    const id = window.setInterval(() => {
      const el = track.current;
      if (!el) return;

      // Nothing to scroll — a short catalogue, or a very wide screen.
      if (el.scrollWidth <= el.clientWidth) return;

      const finished = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (finished) {
        el.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        page(1);
      }
    }, AUTOPLAY_MS);

    // Runs before every re-run and on unmount, so exactly one timer exists at
    // a time and none outlives the component.
    return () => window.clearInterval(id);
  }, [reduced, held, restart, page]);

  return (
    /*
     * Hover and focus are handled on the wrapper so the track, the cards and
     * both arrows are all covered by one pair of handlers. React's onFocus and
     * onBlur are focusin/focusout underneath, so they fire for descendants;
     * the relatedTarget check keeps focus moving *between* cards from
     * registering as leaving.
     */
    <div
      className="relative mt-6"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHeld(false);
        }
      }}
      onTouchStart={() => setRestart((n) => n + 1)}
    >
      {/*
        tabIndex makes the overflow container focusable, which is what lets a
        keyboard user scroll it with the arrow keys — a scrollable region that
        cannot take focus is unreachable without a mouse. Tab still moves
        through the cards themselves, since each one contains a link.
      */}
      <ul
        ref={track}
        tabIndex={0}
        role="group"
        aria-label={label}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 focus-visible:rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500"
      >
        {children}
      </ul>

      {/*
        One arrow per edge, centred on the cards rather than the container —
        `bottom-3` excludes the track's own bottom padding, which would
        otherwise push both buttons half a scrollbar low.

        Hidden below lg on purpose. There, swiping is the natural gesture and a
        40px control over a 274px card would cover more than it helps.
      */}
      <Edge side="left">
        <Arrow
          direction={-1}
          disabled={atStart}
          onClick={() => nudge(-1)}
          label="Scroll to previous apps"
        />
      </Edge>
      <Edge side="right">
        <Arrow
          direction={1}
          disabled={atEnd}
          onClick={() => nudge(1)}
          label="Scroll to more apps"
        />
      </Edge>
    </div>
  );
}

/**
 * Straddles the track's edge: half the button sits over the card's padding,
 * half outside in the page gutter, so it reads as a control on the rail
 * without covering an icon or a title.
 */
function Edge({
  side,
  children,
}: {
  side: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-3 hidden items-center lg:flex ${
        side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
      }`}
    >
      {children}
    </div>
  );
}

function Arrow({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: 1 | -1;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-base-700 bg-base-900/90 text-fg-muted shadow-lg shadow-black/30 backdrop-blur transition-colors hover:border-brand-500/50 hover:text-fg focus-visible:border-brand-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={direction === 1 ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
