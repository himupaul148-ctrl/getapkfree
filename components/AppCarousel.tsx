"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Horizontal, snap-scrolling track for app cards.
 *
 * Client-side only for the arrow buttons — the cards themselves are passed in
 * as `children` and stay server-rendered, so every card is real HTML with a
 * real href in the initial response. That matters more than usual here: this
 * sits on the homepage and is a big share of the site's internal linking.
 *
 * Deliberately no auto-scroll. Content that moves on its own needs a pause
 * control to satisfy WCAG 2.2.2, fights `prefers-reduced-motion`, and on a
 * download site a card sliding out from under the cursor turns into a
 * misclick. Swipe and arrows cover every input without any of that.
 *
 * No carousel library — the project has none, and native overflow scrolling
 * with CSS snap points does the whole job, including iOS momentum, for free.
 */

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
     * Land on a card edge rather than an arbitrary offset, so a click never
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

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      left: el.scrollLeft + target.getBoundingClientRect().left - left,
      behavior: reduced ? "auto" : "smooth",
    });
  }, []);

  return (
    <div className="relative mt-6">
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
        Enhancement only, and only where there is no swipe: a trackpad or mouse
        user has no gesture for a horizontal track. Hidden below lg, where
        swiping is the natural interaction and the buttons would just cover
        cards. aria-hidden because they duplicate scrolling the region above,
        which is already keyboard-operable.
      */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center lg:flex">
        <div className="pointer-events-auto flex gap-2 pl-6">
          <Arrow
            direction={-1}
            disabled={atStart}
            onClick={() => page(-1)}
            label="Scroll to previous apps"
          />
          <Arrow
            direction={1}
            disabled={atEnd}
            onClick={() => page(1)}
            label="Scroll to more apps"
          />
        </div>
      </div>
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
      className="grid h-10 w-10 place-items-center rounded-full border border-base-700 bg-base-900/90 text-fg-muted shadow-lg shadow-black/30 backdrop-blur transition-colors hover:border-brand-500/50 hover:text-fg focus-visible:border-brand-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0"
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
