import type { Metadata } from "next";
import Link from "next/link";
import Prose from "@/components/Prose";

export const metadata: Metadata = {
  title: "About",
  description: "What GetApkFree is, and how builds get listed.",
};

export default function AboutPage() {
  return (
    <Prose
      title="About GetApkFree"
      intro="An open-source catalogue for Android apps, built on the idea that a download page should tell you exactly what you are getting."
    >
      <h2>What this is</h2>
      <p>
        GetApkFree lists Android applications with their full version history.
        Each build records its version code, file size, minimum Android
        release, changelog, and the date its malware scan completed. Nothing is
        hidden behind an interstitial or a download manager.
      </p>

      <h2>How a build gets listed</h2>
      <ul>
        <li>A build is uploaded and enters the catalogue unpublished.</li>
        <li>It is scanned. The result is recorded against that specific build.</li>
        <li>
          Only builds that come back clean are published. Anything pending,
          flagged, or failed stays invisible to the public site — this is
          enforced in the database, not just in the interface.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>No repackaged, patched, or cracked applications.</li>
        <li>No bundled installers, download managers, or ad wrappers.</li>
        <li>No analytics or third-party trackers on this site.</li>
      </ul>

      <h2>Current status</h2>
      <p>
        This deployment is an early build seeded with fictional sample apps so
        the catalogue can be exercised end to end. Download links point at a
        reserved domain and resolve nowhere. Accounts, uploads, and the scanning
        pipeline are not yet connected.
      </p>
      <p>
        If you are here to install something, start with the{" "}
        <Link href="/how-to-install">install guide</Link>.
      </p>
    </Prose>
  );
}
