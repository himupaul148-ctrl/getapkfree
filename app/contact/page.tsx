import type { Metadata } from "next";
import Link from "next/link";
import Prose from "@/components/Prose";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the GetApkFree maintainers.",
};

export default function ContactPage() {
  return (
    <Prose
      title="Contact"
      intro="GetApkFree is open source, so most conversations are better had in the open."
    >
      <h2>Reporting a problem with a build</h2>
      <p>
        If a listed build looks wrong — mismatched package name, a scan result
        you doubt, or metadata that does not match the upstream release — report
        it against the specific app and version so the right build can be
        unpublished while it is checked.
      </p>

      <h2>Takedown requests</h2>
      <p>
        Rights holders should follow the <Link href="/dmca">DMCA process</Link>,
        which sets out what a notice needs to contain.
      </p>

      <h2>Security disclosure</h2>
      <p>
        Please report suspected vulnerabilities privately and give us a chance
        to ship a fix before publishing details.
      </p>

      <h2>Contact routes are not live yet</h2>
      <p>
        This deployment is an early build. A contact address, issue tracker, and
        security disclosure route have not been configured, so there is no form
        here that would actually reach anyone — a form that silently discards
        messages would be worse than none.
      </p>
      <p>
        In the meantime, see <Link href="/about">About</Link> for the current
        status of the project.
      </p>
    </Prose>
  );
}
