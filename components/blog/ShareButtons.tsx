"use client";

import { useState } from "react";

/**
 * Share targets plus a copy-link fallback.
 *
 * The URL is passed in from the server rather than read off `window` so the
 * markup is identical on both renders — reading location during render would
 * produce a hydration mismatch, and reading it in an effect would leave the
 * links inert for anyone who clicks before hydration.
 */
export default function ShareButtons({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const targets = [
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      icon: (
        <path
          d="M17.5 3h3l-6.6 7.5L21.7 21h-6l-4.7-6.1L5.6 21H2.5l7-8L2.4 3h6.2l4.2 5.6L17.5 3Z"
          fill="currentColor"
        />
      ),
    },
    {
      label: "Reddit",
      href: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
      icon: (
        <path
          d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 9.4a1.4 1.4 0 0 0-2.4-1 6.9 6.9 0 0 0-3.4-1l.6-2.7 1.9.4a1 1 0 1 0 .2-.9l-2.4-.5a.4.4 0 0 0-.5.3L10.3 9a7 7 0 0 0-3.5 1 1.4 1.4 0 1 0-1.5 2.3 2.7 2.7 0 0 0 0 .4c0 2 2.3 3.6 5.2 3.6s5.2-1.6 5.2-3.6a2.7 2.7 0 0 0 0-.4 1.4 1.4 0 0 0 .8-1.2ZM9 13a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm5.9 2.6a3.9 3.9 0 0 1-2.4.7 3.9 3.9 0 0 1-2.4-.7.3.3 0 1 1 .4-.5c.5.4 1.2.6 2 .6s1.5-.2 2-.6a.3.3 0 1 1 .4.5ZM14 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
          fill="currentColor"
        />
      ),
    },
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      icon: (
        <path
          d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"
          fill="currentColor"
        />
      ),
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard is blocked in some contexts; the URL is in the address bar */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm text-fg-dim">Share</span>

      {targets.map((target) => (
        <a
          key={target.label}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share on ${target.label}`}
          className="rounded-lg border border-base-700 p-2 text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            {target.icon}
          </svg>
        </a>
      ))}

      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-base-700 px-3 py-2 text-xs text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
