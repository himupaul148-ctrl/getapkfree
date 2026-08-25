"use client";

import { useCallback, useEffect, useState } from "react";

export default function ScreenshotGallery({
  screenshots,
  appName,
}: {
  screenshots: string[];
  appName: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenIndex((i) =>
        i === null ? i : (i + delta + screenshots.length) % screenshots.length,
      ),
    [screenshots.length],
  );

  useEffect(() => {
    if (openIndex === null) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" || event.key === "Right") step(1);
      if (event.key === "ArrowLeft" || event.key === "Left") step(-1);
    }

    document.addEventListener("keydown", onKey);
    // Stop the page scrolling underneath the lightbox.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [openIndex, close, step]);

  if (screenshots.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight">Screenshots</h2>

      {/* Horizontal scroll on narrow screens, grid once there is room. */}
      <ul className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-4 sm:overflow-visible">
        {screenshots.map((src, index) => (
          <li key={src} className="w-40 shrink-0 snap-start sm:w-auto">
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group block w-full overflow-hidden rounded-xl border border-base-800 bg-base-900 transition-colors hover:border-brand-500/50"
              aria-label={`Open screenshot ${index + 1} of ${screenshots.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${appName} screenshot ${index + 1}`}
                loading="lazy"
                className="aspect-[9/16] w-full object-cover transition-transform group-hover:scale-[1.03]"
              />
            </button>
          </li>
        ))}
      </ul>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${appName} screenshot ${openIndex + 1} of ${screenshots.length}`}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-4 right-4 rounded-lg border border-base-700 bg-base-900/80 p-2 text-fg-muted hover:text-fg"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {screenshots.length > 1 && (
            <>
              <NavButton side="left" onClick={() => step(-1)} />
              <NavButton side="right" onClick={() => step(1)} />
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshots[openIndex]}
            alt={`${appName} screenshot ${openIndex + 1}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-auto rounded-xl border border-base-700"
          />

          <p className="absolute bottom-5 text-sm text-fg-muted">
            {openIndex + 1} / {screenshots.length}
          </p>
        </div>
      )}
    </section>
  );
}

function NavButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous screenshot" : "Next screenshot"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-base-700 bg-base-900/80 p-3 text-fg-muted hover:text-fg ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={side === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
