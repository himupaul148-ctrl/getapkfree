import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { CONTACT_EMAIL } from "@/lib/site-config";
import { SITE_NAME, absolute } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: `Contact Us — ${SITE_NAME}` },
  description:
    "Get in touch with the GetApkFree team about a listing, a takedown, a security issue, or anything else. We reply within 24–48 hours.",
  alternates: { canonical: absolute("/contact") },
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
        Contact us
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">
        Questions, corrections, takedowns or security reports — this reaches us
        directly.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
          <p className="text-xs text-fg-dim">Email us directly</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-1 block break-all font-medium text-brand-400 underline hover:no-underline"
          >
            {CONTACT_EMAIL}
          </a>
        </div>
        <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
          <p className="text-xs text-fg-dim">Response time</p>
          <p className="mt-1 font-medium text-fg">24–48 hours</p>
        </div>
      </div>

      <div className="mt-10">
        <ContactForm />
      </div>

      <div className="mt-14 space-y-6 border-t border-base-800 pt-10 leading-relaxed text-fg-muted [&_a]:text-brand-400 [&_a:hover]:underline [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg">
        <h2>Before you write</h2>

        <div>
          <p className="font-medium text-fg">A problem with a listing</p>
          <p className="mt-1">
            Mismatched package name, a scan result you doubt, or metadata that
            does not match the upstream release — tell us which app and which
            version, and the build can be unpublished while it is checked.
          </p>
        </div>

        <div>
          <p className="font-medium text-fg">Takedown requests</p>
          <p className="mt-1">
            Rights holders should follow the{" "}
            <Link href="/dmca">DMCA process</Link>, which sets out what a notice
            needs to contain. It is faster than the form.
          </p>
        </div>

        <div>
          <p className="font-medium text-fg">Security disclosure</p>
          <p className="mt-1">
            Please report suspected vulnerabilities privately and give us a
            chance to ship a fix before publishing details. Use the email
            address above rather than the form.
          </p>
        </div>

        <div>
          <p className="font-medium text-fg">Account deletion</p>
          <p className="mt-1">
            Ask here and we will remove your account, download history and
            favourites, then confirm when it is done. See the{" "}
            <Link href="/privacy">privacy policy</Link> for what we hold.
          </p>
        </div>
      </div>
    </div>
  );
}
