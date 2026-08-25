import type { Metadata } from "next";
import Prose from "@/components/Prose";

export const metadata: Metadata = {
  title: "How to Install",
  description:
    "Step-by-step guide to installing an APK safely on Android, including how to verify a download before you open it.",
};

export default function HowToInstallPage() {
  return (
    <Prose
      title="How to install an APK"
      intro="Sideloading is safe when you know where the file came from and you check it before opening it. Here is the whole process."
    >
      <h2>1. Allow installs from your browser or file manager</h2>
      <p>
        Android blocks installs from outside the Play Store by default. On
        Android 8 and newer the permission is granted per app, not globally:
        open <strong>Settings → Apps → Special app access → Install unknown
        apps</strong>, pick the app you will open the APK from (usually your
        browser or file manager), and enable it.
      </p>
      <p>
        Turn the permission back off when you are done. It only needs to be on
        for the moment you tap the file.
      </p>

      <h2>2. Check the build before you install</h2>
      <p>
        Every build listed here carries a scan date and a version code. Before
        installing, confirm two things on the app page:
      </p>
      <ul>
        <li>The build shows a green <strong>Scanned</strong> badge.</li>
        <li>
          The <strong>package name</strong> matches the app you expect. A
          mismatched package name is the most common sign of a repackaged APK.
        </li>
      </ul>

      <h2>3. Check it will run on your device</h2>
      <p>
        Each build lists a minimum Android version. Find yours under{" "}
        <strong>Settings → About phone → Android version</strong>, then use the{" "}
        <strong>Runs on</strong> filter on the home page to hide anything your
        device cannot install.
      </p>

      <h2>4. Install</h2>
      <ol>
        <li>Download the APK.</li>
        <li>Open it from your notification shade or file manager.</li>
        <li>Review the permissions Android lists, then confirm.</li>
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

      <h2>A note on this demo</h2>
      <p>
        This deployment is seeded with fictional sample apps and its download
        links are non-functional placeholders, so there is nothing here to
        actually install yet.
      </p>
    </Prose>
  );
}
