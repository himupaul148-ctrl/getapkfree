import { CATEGORIES } from "@/lib/types";

export type FetchedMetadata = {
  name: string | null;
  packageName: string | null;
  description: string | null;
  iconUrl: string | null;
  developer: string | null;
  category: string | null;
  version: string | null;
  rating: number | null;
  ratingCount: number | null;
  screenshots: string[];
  /** Which extractor produced this, so the admin form can show its caveats. */
  source: "play" | "fdroid" | "github" | "web";
  /** Fields this source genuinely does not expose. Shown in the form. */
  unavailable: string[];
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    // Fetched once when an admin adds an app; never cache a partial scrape.
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.text();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Play genre constants and F-Droid labels both need folding into our eight. */
function toCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().replace(/[_-]+/g, " ");

  const rules: [RegExp, (typeof CATEGORIES)[number]][] = [
    [/game|arcade|puzzle|casual|strateg|racing|simulation|rpg/, "Games"],
    [/music|audio|video|photo|media|entertainment/, "Multimedia"],
    [/communicat|social|messag|news|browser|network/, "Internet"],
    [/productiv|business|finance|office|note/, "Productivity"],
    [/educat|book|reference|learn/, "Education"],
    [/writ|journal|text/, "Writing"],
    [/system|personal|launcher|device/, "System"],
    [/tool|util|develop/, "Tools"],
  ];
  for (const [re, cat] of rules) if (re.test(v)) return cat;

  const exact = CATEGORIES.find((c) => c.toLowerCase() === v);
  return exact ?? null;
}

/**
 * Attribute order is not fixed — Play emits name= before property= on
 * og:description — so match any <meta> that carries the property and pull the
 * content out separately rather than assuming a layout.
 */
function ogTag(html: string, prop: string): string | null {
  const tag = html.match(
    new RegExp(`<meta[^>]*property="og:${prop}"[^>]*>`, "i"),
  )?.[0];
  const content = tag?.match(/content="([^"]*)"/i)?.[1];
  return content ? decodeEntities(content) : null;
}

/* ------------------------------------------------------------------ Play */

/**
 * Play embeds a schema.org SoftwareApplication block, which is far steadier
 * than reading the AF_initDataCallback blobs: it is a documented format and
 * survives the layout churn that breaks positional scraping.
 *
 * Two things are genuinely absent from the page. The version number moved
 * behind the "About this app" sheet and is frequently "Varies with device"
 * anyway, and the install count only appears as a rounded badge ("1B+"). That
 * badge is the one positional match here, so a miss degrades to null rather
 * than throwing.
 */
async function fromPlay(url: string): Promise<FetchedMetadata> {
  const packageName = new URL(url).searchParams.get("id");
  if (!packageName) throw new Error("Play URL has no ?id= package name.");

  const html = await getText(
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(
      packageName,
    )}&hl=en&gl=US`,
  );

  const block = html.match(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];

  let ld: Record<string, unknown> = {};
  if (block) {
    try {
      ld = JSON.parse(block);
    } catch {
      /* fall back to og: tags below */
    }
  }

  const rating = ld.aggregateRating as
    | { ratingValue?: string; ratingCount?: string }
    | undefined;
  const author = ld.author as { name?: string } | undefined;

  const name =
    (ld.name as string | undefined) ??
    ogTag(html, "title")?.replace(/\s*[-–]\s*Apps on Google Play\s*$/, "") ??
    null;

  const installs =
    html.match(/>([\d.]+[KMB]\+)<\/div><div[^>]*>Downloads</)?.[1] ?? null;

  return {
    name: name ? decodeEntities(name).trim() : null,
    packageName,
    description: ogTag(html, "description"),
    iconUrl: (ld.image as string | undefined) ?? ogTag(html, "image"),
    developer: author?.name ?? null,
    category: toCategory((ld.applicationCategory ?? ld.genre) as string),
    version: null,
    rating: rating?.ratingValue ? Number(rating.ratingValue) : null,
    ratingCount: rating?.ratingCount ? Number(rating.ratingCount) : null,
    screenshots: [],
    source: "play",
    unavailable: [
      "version — Google no longer publishes it on the store page",
      installs
        ? `exact install count — the page only gives the rounded "${installs}"`
        : "install count",
      "screenshots — served from a lazy-loaded blob, not the initial HTML",
    ],
  };
}

/* --------------------------------------------------------------- F-Droid */

/**
 * The per-package API returns version numbers only, so name, description and
 * icon come from the package page's og: tags. That avoids pulling the 56MB
 * index just to add a single app.
 */
async function fromFdroid(url: string): Promise<FetchedMetadata> {
  const packageName =
    new URL(url).pathname.match(/\/packages\/([^/]+)/)?.[1] ?? null;
  if (!packageName) {
    throw new Error("F-Droid URL has no /packages/<id> segment.");
  }

  const [html, api] = await Promise.all([
    getText(`https://f-droid.org/en/packages/${packageName}/`),
    fetch(`https://f-droid.org/api/v1/packages/${packageName}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const suggested = api?.suggestedVersionCode;
  const version =
    api?.packages?.find(
      (p: { versionCode: number }) => p.versionCode === suggested,
    )?.versionName ??
    api?.packages?.[0]?.versionName ??
    null;

  // og:title is "<App> | F-Droid - Free and Open Source Android App Repository".
  const title = ogTag(html, "title")?.split(" | ")[0]?.trim() ?? null;

  return {
    name: title,
    packageName,
    description: ogTag(html, "description"),
    iconUrl: ogTag(html, "image"),
    developer: null,
    // The package page renders its categories as plain text with no stable
    // hook, so this is left for the admin rather than guessed at.
    category: null,
    version,
    rating: null,
    ratingCount: null,
    screenshots: [],
    source: "fdroid",
    unavailable: [
      "rating and install count — F-Droid does not collect them",
      "category and developer — not exposed in the package page markup",
    ],
  };
}

/* ---------------------------------------------------------------- GitHub */

/**
 * Uses the REST API rather than the rendered page. Unauthenticated calls are
 * capped at 60/hour per IP, which is ample for hand-adding apps but will 403
 * on a busy shared address, so that case is named explicitly.
 */
async function fromGithub(url: string): Promise<FetchedMetadata> {
  const m = new URL(url).pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (!m) throw new Error("GitHub URL is not /<owner>/<repo>.");
  const [, owner, repoRaw] = m;
  const repo = repoRaw.replace(/\.git$/, "");

  const api = async (path: string) => {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}${path}`,
      {
        headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (res.status === 403) {
      throw new Error(
        "GitHub API rate limit reached (60/hour per IP). Try again later.",
      );
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}.`);
    return res.json();
  };

  const repoData = await api("");
  if (!repoData) throw new Error("Repository not found.");
  const release = await api("/releases/latest");

  return {
    name: repoData.name ?? null,
    packageName: null,
    description: repoData.description ?? null,
    iconUrl: repoData.owner?.avatar_url ?? null,
    developer: repoData.owner?.login ?? null,
    category: toCategory((repoData.topics ?? []).join(" ")),
    version: release?.tag_name?.replace(/^v/, "") ?? null,
    rating: null,
    ratingCount: null,
    screenshots: [],
    source: "github",
    unavailable: [
      "package name — not derivable from a repo, set it by hand",
      "rating and install count",
      ...(release ? [] : ["version — the repo has no published release"]),
    ],
  };
}

/* ------------------------------------------------------------ plain page */

/** Last resort for a developer's own site: whatever og: tags it publishes. */
async function fromWeb(url: string): Promise<FetchedMetadata> {
  const html = await getText(url);
  const title =
    ogTag(html, "title") ?? html.match(/<title[^>]*>([^<]*)</)?.[1] ?? null;

  return {
    name: title ? decodeEntities(title).trim() : null,
    packageName: null,
    description: ogTag(html, "description"),
    iconUrl: ogTag(html, "image"),
    developer: new URL(url).hostname.replace(/^www\./, ""),
    category: null,
    version: null,
    rating: null,
    ratingCount: null,
    screenshots: [],
    source: "web",
    unavailable: [
      "package name, version, rating and install count — a plain page exposes none of these",
    ],
  };
}

export async function fetchMetadata(url: string): Promise<FetchedMetadata> {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "play.google.com") return fromPlay(url);
  if (host === "f-droid.org" || host.endsWith(".f-droid.org")) {
    return fromFdroid(url);
  }
  if (host === "github.com") return fromGithub(url);
  return fromWeb(url);
}
