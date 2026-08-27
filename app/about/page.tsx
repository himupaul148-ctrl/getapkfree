import type { Metadata } from "next";
import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import ScanBadge from "@/components/ScanBadge";
import SourceBadge from "@/components/SourceBadge";
import { getCatalogue } from "@/lib/catalogue";
import { CONTACT_EMAIL } from "@/lib/site-config";
import { SITE_NAME, absolute } from "@/lib/seo";

// Reads the catalogue so the counts on this page are the real ones. Cached
// hourly by getCatalogue, so this is one query per hour, not per visitor.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: `About ${SITE_NAME}` },
  description:
    "GetApkFree is an open-source app catalogue. We list F-Droid builds with full version history and link everything else to its official publisher. No repacks, no piracy.",
  alternates: { canonical: absolute("/about") },
};

export default async function AboutPage() {
  const { apps } = await getCatalogue();

  const total = apps.length;
  const external = apps.filter((a) => a.sourceType === "external").length;
  const hosted = total - external;
  // A few real icons, so the strip on this page is the actual catalogue rather
  // than a stock image that will drift out of date.
  const showcase = [...apps]
    .filter((a) => a.iconUrl)
    .sort((a, b) => b.downloadCount - a.downloadCount)
    .slice(0, 12);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
        About GetApkFree
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">
        Open-source app distribution made easy — and, more to the point, made
        legible. A download page should tell you exactly what you are getting.
      </p>

      {/* ---- Live catalogue strip ---- */}
      {showcase.length > 0 && (
        <div className="mt-10 rounded-2xl border border-base-800 bg-base-900 p-6">
          <ul className="flex flex-wrap gap-3">
            {showcase.map((app) => (
              <li key={app.id}>
                <Link href={`/app/${app.slug}`} title={app.name}>
                  <AppIcon src={app.iconUrl} name={app.name} size={44} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-fg-dim">
            A sample of what is in the catalogue right now — every icon links to
            its listing.
          </p>
        </div>
      )}

      <div className="mt-10 space-y-6 leading-relaxed text-fg-muted [&_a]:text-brand-400 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
        <h2>Our mission</h2>
        <p>
          GetApkFree is a legitimate open-source app aggregator. We link to
          F-Droid&rsquo;s free, audited apps and to official app sources. No
          piracy, no modified APKs — just transparency about where a file comes
          from and what is known about it.
        </p>

        <h2>How it works</h2>
        <p>
          There are {total.toLocaleString()} apps listed, and each one is
          sourced in one of two ways.
        </p>
        <ul>
          <li>
            <strong>{hosted.toLocaleString()} builds from F-Droid.</strong> We
            mirror the metadata — version history, size, minimum Android
            release, permissions, changelog — and link directly to
            F-Droid&rsquo;s own APK. The file comes from{" "}
            <a
              href="https://f-droid.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              f-droid.org
            </a>
            , not from us.
          </li>
          <li>
            <strong>
              {external.toLocaleString()} external{" "}
              {external === 1 ? "listing" : "listings"}.
            </strong>{" "}
            For apps published elsewhere, we send you to the official source —
            Google Play, a GitHub release, or the developer&rsquo;s own page.
          </li>
        </ul>
        <p>Every listing carries a badge saying which it is:</p>
      </div>

      {/* ---- Badge samples: the real components, not screenshots ---- */}
      <div className="mt-5 flex flex-wrap gap-3 rounded-2xl border border-base-800 bg-base-900 p-5">
        <SourceBadge sourceType="fdroid" externalUrl={null} size="md" />
        <SourceBadge
          sourceType="external"
          externalUrl="https://play.google.com/store/apps/details?id=example"
          size="md"
        />
      </div>

      <div className="mt-6 space-y-6 leading-relaxed text-fg-muted [&_a]:text-brand-400 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
        <h2>Safety</h2>
        <p>
          Builds we link from F-Droid are checked against{" "}
          <a
            href="https://www.virustotal.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            VirusTotal
          </a>{" "}
          before they are published, and the result is recorded against that
          specific build — not the app in general. Only builds that come back
          clean reach the public catalogue. That rule is enforced in the
          database, not just in the interface, so an unscanned build cannot leak
          onto the site through a bug in a page.
        </p>
        <p>Each listing shows one of these:</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 rounded-2xl border border-base-800 bg-base-900 p-5">
        <ScanBadge status="clean" scannedAt={null} showDate={false} />
        <ScanBadge status="pending" scannedAt={null} showDate={false} />
        <ScanBadge status="external" scannedAt={null} showDate={false} />
      </div>

      <div className="mt-6 space-y-6 leading-relaxed text-fg-muted [&_a]:text-brand-400 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
        <p>
          A clean scan is a useful signal, not a guarantee — it means the file
          did not match known malware when it was checked. External listings are
          not scanned by us, and we say so on the page rather than implying a
          check we did not run.
        </p>

        <h2>Why we exist</h2>
        <p>
          Plenty of people want open-source alternatives to the apps they
          already use, and the honest routes to getting them are scattered or
          intimidating. F-Droid is excellent and not especially discoverable.
          Most other APK sites wrap downloads in interstitials, bundle their own
          installers, or quietly serve repacked builds.
        </p>
        <p>
          We wanted one place where the version history is visible, the source
          is stated plainly, and the download button does what it says. That is
          the whole idea.
        </p>

        <h2>What we do not do</h2>
        <ul>
          <li>No repackaged, patched or cracked applications.</li>
          <li>No bundled installers, download managers or ad wrappers.</li>
          <li>No interstitials or countdown timers before a download.</li>
          <li>No selling of your data. See the privacy policy for specifics.</li>
        </ul>

        <h2>Who builds this</h2>
        <p>
          GetApkFree is built and maintained by the GetApkFree Team. The
          catalogue is assembled from public F-Droid data and hand-added
          listings; the site itself is a small Next.js application backed by
          Supabase.
        </p>

        <h2>Get in touch</h2>
        <p>
          Questions, corrections, or a listing that looks wrong? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or use the{" "}
          <Link href="/contact">contact form</Link>. We aim to reply within
          24–48 hours.
        </p>
        <p>
          The formal documents are the{" "}
          <Link href="/privacy">Privacy Policy</Link>, the{" "}
          <Link href="/terms">Terms of Service</Link> and the{" "}
          <Link href="/dmca">DMCA process</Link>. If you are here to install
          something, start with the{" "}
          <Link href="/how-to-install">install guide</Link>.
        </p>
      </div>
    </div>
  );
}
