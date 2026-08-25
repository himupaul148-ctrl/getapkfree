/**
 * Native <details> rather than a client component: collapsed by default,
 * keyboard accessible, and it still works before (or without) hydration.
 */
export default function Disclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group mt-6 overflow-hidden rounded-2xl border border-base-800 bg-base-900 open:border-base-700"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-base-850 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-semibold text-fg">{title}</span>
          {hint && <span className="ml-2 text-sm text-fg-dim">{hint}</span>}
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="shrink-0 text-fg-dim transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="border-t border-base-800 px-5 py-5">{children}</div>
    </details>
  );
}
