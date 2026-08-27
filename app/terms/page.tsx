import type { Metadata } from "next";
import Link from "next/link";
import Prose from "@/components/Prose";
import { CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "@/lib/site-config";
import { SITE_NAME, absolute } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: `Terms of Service — ${SITE_NAME}` },
  description:
    "The terms for using GetApkFree: what the site is, what you may and may not do with it, and the limits of what we can be held responsible for.",
  alternates: { canonical: absolute("/terms") },
};

function formatted(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function TermsPage() {
  return (
    <Prose
      title="Terms of Service"
      intro="Using GetApkFree means agreeing to what follows. It is short, and written plainly on purpose."
    >
      <p className="text-sm text-fg-dim">
        Last updated {formatted(LEGAL_LAST_UPDATED)}
      </p>

      <h2>What GetApkFree is</h2>
      <p>
        GetApkFree is a catalogue of Android applications. It works two ways,
        and every listing tells you which one applies:
      </p>
      <ul>
        <li>
          <strong>F-Droid builds.</strong> We list apps published in{" "}
          <a
            href="https://f-droid.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            F-Droid&rsquo;s
          </a>{" "}
          repository along with their version history, and link directly to
          F-Droid&rsquo;s own APK files. The download comes from F-Droid&rsquo;s
          servers, not ours.
        </li>
        <li>
          <strong>External listings.</strong> For apps published elsewhere, we
          list the app and send you to the official source — Google Play, a
          GitHub release, or the developer&rsquo;s own site. We do not host
          those files and never serve them.
        </li>
      </ul>
      <p>
        We do not repackage, patch, modify or crack applications. We do not host
        pirated software. If you find something on this site that you believe
        breaks that rule, tell us and we will take it down.
      </p>

      <h2>Licensing</h2>
      <p>
        Apps sourced from F-Droid are free and open-source software, each under
        its own licence — most commonly GPL, Apache 2.0 or MIT. Those licences
        come from the app&rsquo;s authors and govern what you may do with the
        software. Our listing them here does not change or extend any of them.
        F-Droid documents its inclusion requirements at{" "}
        <a
          href="https://f-droid.org/docs/Inclusion_Policy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          f-droid.org/docs/Inclusion_Policy
        </a>
        .
      </p>
      <p>
        Apps we link to externally are governed entirely by their own publisher
        and their own terms. Once you follow one of those links you are dealing
        with that publisher, not with us.
      </p>

      <h2>What you may do</h2>
      <ul>
        <li>Browse, search and download anything listed, for free.</li>
        <li>Create an account to keep favourites and a download history.</li>
        <li>Link to the site and to individual app pages.</li>
      </ul>

      <h2>What you may not do</h2>
      <ul>
        <li>
          <strong>Redistribute unlawfully.</strong> Do not copy applications
          from here in ways their licences do not permit.
        </li>
        <li>
          <strong>Scrape the site.</strong> Automated bulk downloading, crawling
          beyond what our{" "}
          <a href="/robots.txt">robots.txt</a> permits, or hammering the site in
          a way that degrades it for others. If you want the catalogue data,
          ask.
        </li>
        <li>
          <strong>Spam or abuse.</strong> That includes the contact form and any
          account features.
        </li>
        <li>
          <strong>Break things.</strong> No attempts to gain unauthorised
          access, probe for vulnerabilities without telling us, or interfere
          with the service. Genuine security research is welcome — report it
          privately first.
        </li>
        <li>
          <strong>Misrepresent us.</strong> Do not imply we endorse, publish or
          maintain an app that we merely list.
        </li>
      </ul>
      <p>
        We may suspend or remove an account that does any of the above.
      </p>

      <h2>Safety scanning, and its limits</h2>
      <p>
        Builds we link from F-Droid are checked against VirusTotal, and each
        listing shows the result and the date it was scanned. That is a useful
        signal and it is not a guarantee. A clean scan means the file did not
        match known malware at the time it was checked — it does not certify
        that an app is safe, well-behaved, or does what it claims.
      </p>
      <p>
        External listings are not scanned by us at all. We say so on those
        pages, because the download comes from the publisher.
      </p>
      <p>
        Read the <Link href="/how-to-install">install guide</Link> before
        sideloading anything, and take Play Protect warnings seriously.
      </p>

      <h2>No warranty</h2>
      <p>
        The site and everything listed on it are provided <strong>as is</strong>
        , without warranty of any kind, express or implied. We do not warrant
        that the site will be uninterrupted or error-free, that metadata is
        accurate or current, or that any application is fit for a particular
        purpose.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        We are not the authors of the applications listed here. To the fullest
        extent the law allows, GetApkFree is not liable for any loss or damage
        arising from:
      </p>
      <ul>
        <li>
          an application you downloaded — how it behaves, what it accesses, or
          any harm it causes;
        </li>
        <li>data loss, device damage or downtime;</li>
        <li>
          anything on a third-party site we link to, including Google Play,
          GitHub, F-Droid and developers&rsquo; own sites;
        </li>
        <li>the site being unavailable or a listing being wrong.</li>
      </ul>
      <p>
        Nothing here excludes liability that cannot lawfully be excluded. Some
        jurisdictions do not allow certain exclusions, in which case the ones
        they disallow do not apply to you.
      </p>

      <h2>Accounts</h2>
      <p>
        You are responsible for keeping your password to yourself and for what
        happens under your account. Tell us if you think it has been
        compromised. You can ask us to delete your account at any time — see the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Takedowns</h2>
      <p>
        Rights holders should follow the <Link href="/dmca">DMCA process</Link>,
        which sets out what a notice needs to contain. We act on valid notices.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. The date at the top changes when we do, and
        material changes will be noted on this page. Continuing to use the site
        after a change means accepting the revised terms. If you do not accept
        them, stop using the site.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or use the{" "}
        <Link href="/contact">contact form</Link>.
      </p>
      <p>
        See also the <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/about">About</Link>.
      </p>
    </Prose>
  );
}
