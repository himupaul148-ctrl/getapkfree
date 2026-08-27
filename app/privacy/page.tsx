import type { Metadata } from "next";
import Link from "next/link";
import Prose from "@/components/Prose";
import {
  CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  adsEnabled,
  analyticsEnabled,
} from "@/lib/site-config";
import { SITE_NAME, absolute } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: `Privacy Policy — ${SITE_NAME}` },
  description:
    "What GetApkFree collects, why, who we share it with, and how to delete your data or opt out of analytics and personalised advertising.",
  alternates: { canonical: absolute("/privacy") },
};

function formatted(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function PrivacyPage() {
  return (
    <Prose
      title="Privacy Policy"
      intro="This explains what we collect, why we collect it, and what you can do about it. It is written to be read, not to be survived."
    >
      <p className="text-sm text-fg-dim">
        Last updated {formatted(LEGAL_LAST_UPDATED)}
      </p>

      <h2>The short version</h2>
      <p>
        You do not need an account to browse or download. If you make one, we
        store your email address and username and nothing else about you. We do
        not sell your data.
        {analyticsEnabled || adsEnabled
          ? " We use Google services for analytics and advertising, described in full below."
          : " We do not currently run analytics or advertising on this site."}
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your email address and username</strong>, if you create an
          account. The email is how you sign in and how we would reach you about
          your account. Nothing else about you is required.
        </li>
        <li>
          <strong>Your download history</strong>, if you are signed in when you
          download. This is what makes the list on your profile page work.
        </li>
        <li>
          <strong>Your favourites</strong>, if you save any. Visible only to
          your account.
        </li>
        <li>
          <strong>Anonymous download counts.</strong> Every download increments
          a per-app tally. When you are signed out, that tally is all that is
          recorded — the count is not linked to you.
        </li>
        {analyticsEnabled && (
          <li>
            <strong>Usage data via Google Analytics</strong> — pages viewed,
            approximate location from your IP, device and browser type, and how
            you arrived. We enable IP anonymisation, so Google truncates your
            address before storing it.
          </li>
        )}
      </ul>

      <h2>Why we collect it</h2>
      <ul>
        <li>To run the parts of the site that need an account.</li>
        <li>
          To show which apps are popular, which is how the trending list and the
          catalogue ordering work.
        </li>
        {analyticsEnabled && (
          <li>
            To understand which pages are useful so we know what to improve.
          </li>
        )}
        <li>
          To respond to abuse reports, takedown notices and security
          disclosures, and to meet legal obligations where they apply.
        </li>
      </ul>

      <h2>Who else is involved</h2>
      <p>
        Running a site means handing some data to the companies that host it.
        These are ours:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — the database and authentication. Your
          account record and download history live here.
        </li>
        <li>
          <strong>Vercel</strong> — hosting. Vercel processes server logs,
          including IP addresses, as part of serving requests.
        </li>
        <li>
          <strong>F-Droid</strong> — most downloads are served directly from
          f-droid.org, so your request reaches them rather than us. Their
          privacy practices are their own.
        </li>
        {analyticsEnabled && (
          <li>
            <strong>Google Analytics</strong> — usage measurement, as described
            above.
          </li>
        )}
        {adsEnabled && (
          <li>
            <strong>Google AdSense</strong> — advertising, as described below.
          </li>
        )}
      </ul>

      {adsEnabled ? (
        <>
          <h2>Advertising</h2>
          <p>
            Google, as a third-party vendor, uses cookies to serve ads on this
            site. Google&rsquo;s use of advertising cookies enables it and its
            partners to serve ads to you based on your visit here and to other
            sites on the internet.
          </p>
          <p>
            Third-party vendors and ad networks may also serve ads on this site
            and use cookies of their own. We do not control those cookies.
          </p>
          <p>You can opt out of personalised advertising:</p>
          <ul>
            <li>
              Through{" "}
              <a
                href="https://adssettings.google.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Ads Settings
              </a>
              , which turns off personalisation across Google&rsquo;s products.
            </li>
            <li>
              Through{" "}
              <a
                href="https://optout.aboutads.info"
                target="_blank"
                rel="noopener noreferrer"
              >
                aboutads.info
              </a>
              , which covers many other advertising networks at once.
            </li>
          </ul>
          <p>
            Google&rsquo;s own explanation of how it uses data from sites that
            use its services is at{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noopener noreferrer"
            >
              policies.google.com/technologies/partner-sites
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <h2>Advertising</h2>
          <p>
            There is no advertising on this site at present. If that changes, we
            intend to use Google AdSense — which would mean Google and other
            third-party vendors setting cookies to serve ads based on your
            visits here and elsewhere. This page will be updated before any of
            that happens, and you would be able to opt out through{" "}
            <a
              href="https://adssettings.google.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Ads Settings
            </a>{" "}
            or{" "}
            <a
              href="https://optout.aboutads.info"
              target="_blank"
              rel="noopener noreferrer"
            >
              aboutads.info
            </a>
            .
          </p>
        </>
      )}

      <h2>Cookies</h2>
      <p>
        Signing in sets a session cookie. It is what keeps you signed in and it
        is required — without it, accounts cannot work. Your theme preference is
        stored locally in your browser and never sent to us.
        {(analyticsEnabled || adsEnabled) &&
          " Google Analytics and AdSense set their own cookies, described above."}
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your data, and we do not trade it.</li>
        <li>We do not fingerprint your device.</li>
        <li>
          We do not require an account to browse, search or download anything.
        </li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>Delete your account.</strong> Email us and we will remove your
          account, download history and favourites. We will confirm when it is
          done.
        </li>
        <li>
          <strong>Get a copy of your data.</strong> Ask and we will send you
          what we hold, which is your account record, download history and
          favourites.
        </li>
        <li>
          <strong>Opt out of analytics.</strong> Google publishes a{" "}
          <a
            href="https://tools.google.com/dlpage/gaoptout"
            target="_blank"
            rel="noopener noreferrer"
          >
            browser add-on
          </a>{" "}
          that blocks Google Analytics everywhere. Most content blockers do the
          same.
        </li>
        <li>
          <strong>Browse signed out.</strong> Nothing is attributed to you, and
          everything except favourites and history still works.
        </li>
      </ul>

      <h2>How long we keep things</h2>
      <p>
        Account data is kept until you ask us to delete it. Anonymous download
        counts are kept indefinitely — they are aggregate numbers with nothing
        personal in them.
      </p>

      <h2>Children</h2>
      <p>
        This site is not directed at children under 13, and we do not knowingly
        collect their data. If you believe a child has given us information,
        email us and we will remove it.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date at the top. Material
        changes — new categories of data, or a new third party receiving it —
        will be called out on the page rather than slipped in.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions, deletion requests and anything else covered here:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. You can also
        use the <Link href="/contact">contact form</Link>. We aim to reply
        within 24–48 hours.
      </p>
      <p>
        See also our <Link href="/terms">Terms of Service</Link> and the{" "}
        <Link href="/dmca">DMCA process</Link>.
      </p>
    </Prose>
  );
}
