import type { Metadata } from "next";
import Link from "next/link";
import Prose from "@/components/Prose";
import ScanBadge from "@/components/ScanBadge";
import { absolute } from "@/lib/seo";

export const metadata: Metadata = {
  title: "How to Install",
  description:
    "Why these apps are not on Google Play, how to enable installs from unknown sources, how to install an APK, and what the safety badges mean.",
  alternates: { canonical: absolute("/how-to-install") },
};

export default function HowToInstallPage() {
  return (
    <Prose
      title="How to install an APK"
      intro="Sideloading is safe when you know where the file came from and you check it before opening it. Here is the whole process, and what our badges are telling you."
    >
      <h2>Why these apps aren&rsquo;t on Google Play</h2>
      <p>
        Almost everything here is <strong>free and open-source software</strong>,
        most of it mirrored from{" "}
        <a href="https://f-droid.org" rel="noreferrer noopener" target="_blank">
          F-Droid
        </a>
        , a long-running repository that builds apps from published source code.
      </p>
      <p>Open-source apps skip the Play Store for ordinary reasons:</p>
      <ul>
        <li>
          A Play Store listing costs a one-off developer fee and ongoing
          policy compliance work that unpaid volunteers often will not take on.
        </li>
        <li>
          Play requires apps to ship Google&rsquo;s own libraries for some
          features. Projects that avoid tracking deliberately refuse them.
        </li>
        <li>
          Some apps do things Play&rsquo;s policies restrict — ad-blocking,
          per-app firewalls, downloading media, automation across other apps.
        </li>
      </ul>
      <p>
        None of that makes an app unsafe. It does mean nobody is checking it on
        your behalf, which is what the scanning below is for.
      </p>

      <h2>What the safety badges mean</h2>
      <p>
        Every build carries the result of a malware scan, checked against
        VirusTotal&rsquo;s engines by file hash:
      </p>

      <div className="flex flex-col gap-4 rounded-2xl border border-base-800 bg-base-900 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <ScanBadge status="clean" scannedAt={null} />
          <span className="text-sm text-fg-muted">
            No engine flagged this build. The date shown is when it was checked.
            <strong className="text-fg"> Only these appear on the site.</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ScanBadge status="pending" scannedAt={null} />
          <span className="text-sm text-fg-muted">
            No verdict yet — usually a build too new to have been analysed.
            Held back until it clears.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ScanBadge status="flagged" scannedAt={null} />
          <span className="text-sm text-fg-muted">
            At least one engine reported something. Never published; kept only
            for review.
          </span>
        </div>
      </div>

      <p>
        A badge is evidence, not a guarantee. Scanners produce false positives —
        apps that need broad permissions, like firewalls or automation tools,
        get flagged more often than their behaviour warrants. Read the
        permissions list on the app page too.
      </p>

      <h2>1. Allow installs from your browser or file manager</h2>
      <p>
        Android blocks installs from outside the Play Store by default. On
        Android 8 and newer the permission is granted per app, not globally:
      </p>
      <ol>
        <li>
          Open <strong>Settings → Apps → Special app access → Install unknown
          apps</strong>.
        </li>
        <li>
          Pick the app you will open the APK from — usually your browser
          (Chrome, Firefox) or your file manager.
        </li>
        <li>
          Turn on <strong>Allow from this source</strong>.
        </li>
      </ol>
      <p>
        Turn it back off when you are done. It only needs to be on for the
        moment you tap the file. On Android 7 and older the setting is a single
        global toggle at <strong>Settings → Security → Unknown sources</strong>.
      </p>

      <h2>2. Check the build before you install</h2>
      <ul>
        <li>Confirm the build shows a green <strong>Scanned</strong> badge.</li>
        <li>
          Check the <strong>package name</strong> matches the app you expect —
          a mismatch is the commonest sign of a repackaged APK.
        </li>
        <li>
          Skim the permissions. An offline calculator asking for contacts and
          the microphone deserves suspicion.
        </li>
      </ul>

      <h2>3. Check it will run on your device</h2>
      <p>
        Each build lists a minimum Android version. Find yours under{" "}
        <strong>Settings → About phone → Android version</strong>, then use the{" "}
        <strong>Runs on</strong> filter on the home page to hide anything your
        device cannot install.
      </p>

      <h2>4. Install it</h2>
      <ol>
        <li>Tap <strong>Download</strong> on the app page.</li>
        <li>Open the file from your notification shade or Downloads folder.</li>
        <li>Android lists the permissions it wants — read them, then confirm.</li>
        <li>
          Updates are manual: come back and download the newer build when one
          appears. Installing over the top keeps your data.
        </li>
      </ol>

      <h2>If an install fails</h2>
      <ul>
        <li>
          <strong>&ldquo;App not installed&rdquo;</strong> — usually a signature
          clash with an existing copy. Uninstall the old version first; note
          this clears its data.
        </li>
        <li>
          <strong>Parse error</strong> — the file is truncated or built for a
          newer Android release than your device runs.
        </li>
        <li>
          <strong>Blocked by Play Protect</strong> — worth taking seriously.
          Do not bypass it unless you are certain of the source.
        </li>
      </ul>

      <h2>Related guides</h2>
      <ul>
        <li>
          <Link href="/blog/best-privacy-apps-android-2026">
            Best privacy apps for Android in 2026
          </Link>{" "}
          — what to install once sideloading works.
        </li>
        <li>
          <Link href="/blog/top-lightweight-tools-under-10mb">
            Top lightweight tools under 10MB
          </Link>{" "}
          — for older or storage-limited devices.
        </li>
        <li>
          <Link href="/blog">All guides</Link> — the full blog.
        </li>
      </ul>

      <p>
        Browse the <Link href="/">catalogue</Link> when you are ready, or read{" "}
        <Link href="/about">how builds get listed</Link>.
      </p>
    </Prose>
  );
}
