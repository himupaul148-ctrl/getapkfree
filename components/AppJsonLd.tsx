import { buildAppJsonLdData } from "@/lib/app-json-ld";
import type { App, Version } from "@/lib/types";

/**
 * schema.org SoftwareApplication for the app detail page.
 *
 * Emitted as a JSON-LD script rather than microdata so the markup stays clean,
 * and stringified through JSON.stringify with `<` escaped — app descriptions
 * are imported from F-Droid and are not ours to trust inside a script tag.
 *
 * The actual field set lives in lib/app-json-ld.ts's buildAppJsonLdData, so
 * it can be unit-tested without a React renderer.
 */
export default function AppJsonLd({
  app,
  latest,
}: {
  app: App;
  latest: Version | undefined;
}) {
  const data = buildAppJsonLdData(app, latest);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
