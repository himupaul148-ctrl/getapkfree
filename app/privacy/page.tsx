import type { Metadata } from "next";
import Prose from "@/components/Prose";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What GetApkFree stores, and what it deliberately does not.",
};

export default function PrivacyPage() {
  return (
    <Prose
      title="Privacy"
      intro="The short version: no analytics, no advertising, no third-party trackers, and no account required to browse or download."
    >
      <h2>What the site stores</h2>
      <ul>
        <li>
          <strong>Download counts</strong> — a per-app tally. A download may be
          recorded without any account attached to it.
        </li>
        <li>
          <strong>Account data</strong>, if you create an account: an email
          address and a username. Accounts are not yet enabled on this
          deployment.
        </li>
        <li>
          <strong>Favourites</strong>, if you save any — visible only to the
          account that created them.
        </li>
      </ul>

      <h2>What it does not store</h2>
      <ul>
        <li>No analytics or telemetry of any kind.</li>
        <li>No advertising or cross-site tracking cookies.</li>
        <li>No device fingerprinting.</li>
        <li>No selling or sharing of data with third parties.</li>
      </ul>

      <h2>Access control</h2>
      <p>
        Per-user data is isolated at the database level through row-level
        security policies rather than only in application code. An account can
        read its own profile, its own download history, and its own favourites —
        and nothing belonging to anyone else.
      </p>

      <h2>Third parties</h2>
      <p>
        The site is hosted on Vercel and backed by Supabase; each processes
        requests on our behalf and keeps its own operational logs. App icons on
        this demo deployment are fetched from a placeholder image host, which
        will see your IP address when a card renders.
      </p>

      <h2>Your data</h2>
      <p>
        Once accounts are enabled you will be able to export or delete your
        profile, favourites, and download history. Deleting an account removes
        the profile and cascades to its favourites; download rows are detached
        rather than deleted so aggregate counts stay correct.
      </p>
    </Prose>
  );
}
