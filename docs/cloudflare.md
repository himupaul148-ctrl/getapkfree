# Cloudflare CDN setup for getapkfree.com

Nothing here can be applied until `getapkfree.com` is pointed at Cloudflare.
Everything in the app itself is already done — this file is the checklist for
the day the domain goes live.

## Read this first: do you actually need Cloudflare?

Vercel already serves the site from its own global edge network, and the app
now sends cache headers Vercel honours. Putting Cloudflare in front adds a
second cache that must be kept in step with the first. It is worth doing if you
want Cloudflare's WAF, bot rules, analytics or a free plan sitting in front of
Vercel's bandwidth — it is not worth doing purely for speed.

If you do proxy through Cloudflare, set SSL/TLS mode to **Full (strict)**.
Flexible mode causes redirect loops with Vercel.

## What the app already sends

Verified against a production build:

| Route | `Cache-Control` |
| --- | --- |
| `/app/<slug>` | `s-maxage=3600, stale-while-revalidate=31532400` |
| `/about`, `/privacy`, `/dmca`, `/contact`, `/how-to-install` | `s-maxage=31536000` |
| `/_next/static/*` | `public, max-age=31536000, immutable` |
| `/admin`, `/profile`, `/login`, `/signup` | `private, no-store, max-age=0, must-revalidate` |
| `/` (homepage) | `private, no-cache, no-store` — see caveat below |

Cloudflare respects `s-maxage`, so **if you enable "Respect existing headers"
the table above is most of the job** and the rules below are refinements.

## Manual steps in the Cloudflare dashboard

### 1. Add the domain and DNS

1. Add `getapkfree.com` as a site.
2. Point the nameservers at Cloudflare with your registrar.
3. In Vercel: Project → Settings → Domains → add `getapkfree.com`. Vercel
   shows the DNS record it needs.
4. In Cloudflare DNS, create that record with the **orange cloud on** (proxied).
5. SSL/TLS → Overview → **Full (strict)**.

### 2. Cache rules

Under **Caching → Cache Rules**, in this order. Order matters: the first
matching rule wins.

**Rule 1 — never cache authenticated routes**

```
Expression:  (starts_with(http.request.uri.path, "/admin")) or
             (starts_with(http.request.uri.path, "/profile")) or
             (starts_with(http.request.uri.path, "/login")) or
             (starts_with(http.request.uri.path, "/signup")) or
             (starts_with(http.request.uri.path, "/auth")) or
             (starts_with(http.request.uri.path, "/api"))
Setting:     Bypass cache
```

Put this first. These routes are gated by `proxy.ts`, and a CDN that caches a
signed-in response would serve one person's session state to the next visitor.

**Rule 2 — static assets, cache hard**

```
Expression:  (starts_with(http.request.uri.path, "/_next/static")) or
             (starts_with(http.request.uri.path, "/_next/image"))
Setting:     Eligible for cache
Edge TTL:    Respect origin (they are already immutable / 30 days)
Browser TTL: Respect origin
```

**Rule 3 — app pages**

```
Expression:  starts_with(http.request.uri.path, "/app/")
Setting:     Eligible for cache
Edge TTL:    Respect origin   (the app sends s-maxage=3600)
Browser TTL: 5 minutes
```

Prefer "Respect origin" over a hard-coded hour. The app already decides the
TTL, and a rule that disagrees is one more thing to keep in sync.

### 3. Cache key — the one that will bite you

Under the cache rule for `/app/*`, open **Cache Key** and **include the query
string**. Next.js distinguishes an HTML response from an RSC payload using a
`_rsc` query parameter. If Cloudflare strips or ignores the query string, it
will happily serve an RSC payload to a browser expecting HTML, and pages break
in ways that look random.

Also leave `Vary` handling alone. Next sets `Vary: rsc, next-router-prefetch,
next-router-state-tree`, and the `_rsc` parameter exists precisely so CDNs that
ignore `Vary` still key correctly.

### 4. Do not enable

- **Auto Minify** — Next already minifies; double-processing hashed bundles
  risks breaking them.
- **Rocket Loader** — reorders script execution and breaks React hydration.
- **Email Obfuscation** on app pages — rewrites markup inside the RSC payload.
- **Always Online** — would serve stale catalogue pages indefinitely.

### 5. Purging after a deploy

Vercel gives each deploy new hashed asset URLs, so `/_next/static` needs no
purge. App pages do: after a deploy that changes page markup, run a
**Purge Everything**, or purge by prefix `/app/`.

If you later wire up on-demand revalidation, note that `revalidateTag()`
invalidates the Next.js cache but **not** Cloudflare's — you would need to call
Cloudflare's purge API alongside it.

## Caveats

**The homepage is not cacheable as built.** It reads `searchParams` so that
filtered views (`/?search=note&category=Tools`) are shareable, and reading
search params makes a route dynamic in the App Router. Its Supabase query is
cached for an hour instead, so the database cost is the same as a cached page —
only the HTML render is repeated. To make the homepage itself CDN-cacheable,
move filter initialisation from `searchParams` to `window.location.search` in
`FilterProvider`; the trade is that a filtered link renders the full catalogue
first and narrows after hydration.

**APK files are not served by us.** `file_url` points at `f-droid.org`, so APK
download bandwidth never touches Cloudflare or Vercel. Nothing to cache there,
and no egress cost on our side.

**Cache Components / PPR** (`cacheComponents: true` in `next.config.ts`) would
let the homepage have a static shell with dynamic holes, which is the proper
fix for the caveat above. It changes rendering behaviour across the whole app,
so it deserves its own pass rather than being bundled into a CDN change.
