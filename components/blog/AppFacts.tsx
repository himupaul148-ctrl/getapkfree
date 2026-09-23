import SourceBadge from "@/components/SourceBadge";
import type { TargetAppLink } from "@/lib/blog";

/**
 * The App Related layout's "APP FACTS" block — mirrors the visual idiom of
 * app/app/[slug]/page.tsx's own "Quick info bar" (the same `dl` grid, same
 * border/background tokens) rather than inventing a new fact-grid pattern,
 * but only the small, purpose-built set of facts an article actually needs:
 * version, Android requirement, license, source, package name. Never the
 * full app page's screenshots/permissions/version-history/download button —
 * this is explicitly not a second copy of that page.
 *
 * Every optional fact (version, Android requirement, license) is omitted
 * when absent, the same "don't show what isn't there" rule
 * lib/seo.ts's licenseAndTargetSdkLine already applies on the app page
 * itself — never a fabricated placeholder. Package name and source are
 * always shown: both columns are NOT NULL on every app row.
 */
export default function AppFacts({ app }: { app: TargetAppLink }) {
  const facts: { label: string; value: string }[] = [
    app.latest_version ? { label: "Version", value: app.latest_version } : null,
    app.min_android_version
      ? { label: "Requires", value: `Android ${app.min_android_version}+` }
      : null,
    app.license ? { label: "License", value: app.license } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-base-800 bg-base-800 sm:grid-cols-4">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-col justify-center gap-1 bg-base-900 px-4 py-3.5"
        >
          <dt className="text-xs text-fg-dim">{fact.label}</dt>
          <dd className="truncate font-medium text-fg">{fact.value}</dd>
        </div>
      ))}

      <div className="flex flex-col justify-center gap-1 bg-base-900 px-4 py-3.5">
        <dt className="text-xs text-fg-dim">Source</dt>
        <dd>
          <SourceBadge sourceType={app.source_type} externalUrl={app.external_url} />
        </dd>
      </div>

      <div className="flex flex-col justify-center gap-1 bg-base-900 px-4 py-3.5">
        <dt className="text-xs text-fg-dim">Package</dt>
        <dd className="truncate font-mono text-xs font-medium text-fg" title={app.package_name}>
          {app.package_name}
        </dd>
      </div>
    </dl>
  );
}
