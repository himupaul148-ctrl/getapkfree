import type { Metadata } from "next";
import Prose from "@/components/Prose";

export const metadata: Metadata = {
  title: "DMCA",
  description: "How to report allegedly infringing content on GetApkFree.",
};

export default function DmcaPage() {
  return (
    <Prose
      title="DMCA / takedown policy"
      intro="GetApkFree is intended to distribute freely redistributable and open-source Android applications. If something here should not be, tell us and it comes down."
    >
      <h2>Scope</h2>
      <p>
        Builds are meant to be listed only where their licence permits
        redistribution. Repackaged, patched, or paid applications are outside
        the scope of this catalogue and are removed on sight.
      </p>

      <h2>Filing a notice</h2>
      <p>
        If you hold the rights to an application listed here, or act on behalf
        of someone who does, send a notice including:
      </p>
      <ul>
        <li>The specific app page and build version you are reporting.</li>
        <li>The package name, so the right listing is identified.</li>
        <li>
          A description of the work and the rights you hold, or your authority
          to act for the rights holder.
        </li>
        <li>Contact details we can reply to.</li>
        <li>
          A statement that you believe in good faith the use is not authorised
          by the rights holder or the law, and that the information in the
          notice is accurate.
        </li>
      </ul>

      <h2>What happens next</h2>
      <ul>
        <li>
          Reported builds are unpublished immediately while the notice is
          reviewed. Unpublishing hides a build from the entire public site.
        </li>
        <li>
          If the notice is upheld, the build and any related versions are
          removed.
        </li>
        <li>
          If it is not, the build is restored and you receive an explanation.
        </li>
      </ul>

      <h2>Counter-notice</h2>
      <p>
        If your build was removed and you believe that was a mistake, reply to
        the removal notice with your reasoning and the licence terms that permit
        redistribution.
      </p>

      <h2>Contact route</h2>
      <p>
        A dedicated takedown address is not yet configured for this deployment.
        Until it is, use the details on the contact page. Note that this
        installation currently hosts only fictional sample entries with
        placeholder links and no real application binaries.
      </p>
    </Prose>
  );
}
