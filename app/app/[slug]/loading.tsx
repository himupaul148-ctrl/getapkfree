import { AppGridSkeleton } from "@/components/Skeletons";

function Block({ className }: { className: string }) {
  return <div className={`rounded bg-base-800 ${className}`} aria-hidden="true" />;
}

/** Mirrors the detail page's shape so nothing shifts when the data lands. */
export default function AppDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-hidden="true">
      <Block className="h-4 w-32" />

      <header className="mt-6 flex animate-pulse flex-col gap-5 sm:flex-row sm:items-start">
        <div className="h-26 w-26 shrink-0 rounded-xl bg-base-800" style={{ height: 104, width: 104 }} />
        <div className="min-w-0 flex-1 space-y-3">
          <Block className="h-9 w-2/3" />
          <Block className="h-4 w-40" />
          <Block className="h-3 w-56" />
          <div className="flex gap-3 pt-1">
            <Block className="h-5 w-20 rounded-full" />
            <Block className="h-5 w-28 rounded-full" />
          </div>
        </div>
        <Block className="h-11 w-24 rounded-xl" />
      </header>

      {/* Quick info bar */}
      <div className="mt-8 grid animate-pulse grid-cols-2 gap-px overflow-hidden rounded-2xl border border-base-800 bg-base-800 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 bg-base-900 px-4 py-3.5">
            <Block className="h-3 w-16" />
            <Block className="h-4 w-24" />
          </div>
        ))}
      </div>

      <Block className="mt-6 h-14 w-full animate-pulse rounded-2xl" />

      <div className="mt-10 animate-pulse space-y-3">
        <Block className="h-5 w-40" />
        <Block className="h-3 w-full" />
        <Block className="h-3 w-11/12" />
      </div>

      {/* Screenshots */}
      <div className="mt-10 grid animate-pulse grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="aspect-[9/16] rounded-xl bg-base-800" />
        ))}
      </div>

      <Block className="mt-6 h-14 w-full animate-pulse rounded-2xl" />
      <Block className="mt-3 h-14 w-full animate-pulse rounded-2xl" />

      <div className="mt-16">
        <Block className="mb-6 h-7 w-56 animate-pulse" />
        <AppGridSkeleton count={4} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" />
      </div>

    </div>
  );
}
