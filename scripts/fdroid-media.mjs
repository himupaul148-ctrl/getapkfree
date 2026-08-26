/**
 * Resolves an app's icon and screenshots out of an F-Droid index-v1 entry.
 *
 * The index stores media in two different places and the original importer
 * only looked at one of them:
 *
 *   - `app.icon` is a bare filename under /repo/icons-640/. Only about 44% of
 *     apps have it; the rest publish their icon per-locale instead.
 *   - `app.localized[locale].icon` is a bare filename that lives beside the
 *     locale directory: /repo/<package>/<locale>/<file>. Note there is NO
 *     "icon/" path segment — that URL 404s.
 *   - `app.localized[locale].phoneScreenshots` are bare filenames under
 *     /repo/<package>/<locale>/phoneScreenshots/. These were never read at
 *     all, which is why every imported app had an empty gallery.
 *
 * Locale choice matters: the asset only exists under the locale that declared
 * it, so we take the first locale that actually has the field rather than
 * assuming en-US and building a URL that 404s.
 */

const REPO_BASE = "https://f-droid.org/repo";

/** en-US and en first, then whatever else the app ships. */
function localeOrder(localized) {
  const keys = Object.keys(localized ?? {});
  const preferred = ["en-US", "en"].filter((k) => keys.includes(k));
  return [...preferred, ...keys.filter((k) => !preferred.includes(k))];
}

/** Screenshots are capped: the gallery shows four and lightboxes the rest. */
const MAX_SCREENSHOTS = 8;

export function resolveMedia(app, packageName) {
  const localized = app.localized ?? {};
  const order = localeOrder(localized);

  let iconUrl = app.icon ? `${REPO_BASE}/icons-640/${app.icon}` : null;
  if (!iconUrl) {
    for (const locale of order) {
      const icon = localized[locale]?.icon;
      if (typeof icon === "string" && icon) {
        iconUrl = `${REPO_BASE}/${packageName}/${locale}/${icon}`;
        break;
      }
    }
  }

  let screenshots = [];
  for (const locale of order) {
    const shots = localized[locale]?.phoneScreenshots;
    if (Array.isArray(shots) && shots.length) {
      screenshots = shots
        .filter((f) => typeof f === "string" && f)
        .slice(0, MAX_SCREENSHOTS)
        .map((f) => `${REPO_BASE}/${packageName}/${locale}/phoneScreenshots/${f}`);
      break;
    }
  }

  return { iconUrl, screenshots };
}
