# Google Analytics 4

Analytics is **off** until a measurement ID is configured. With no ID set, no
Google script is loaded at all — the page source contains nothing from
`googletagmanager.com`, and the privacy policy reads the same flag, so it says
"we do not currently run analytics" rather than claiming otherwise.

## Getting a measurement ID

1. Go to [google.com/analytics](https://google.com/analytics) and sign in.
2. **Admin → Create → Property.** Name it `getapkfree.com`, set the timezone
   and currency.
3. Under **Data streams**, create a **Web** stream for
   `https://getapkfree.vercel.app` (or your custom domain).
4. Copy the **Measurement ID**. It looks like `G-XXXXXXXXXX`.

## Configuring it

Locally, in `.env.local`:

```
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

Restart the dev server — `NEXT_PUBLIC_*` variables are inlined at build time,
so a running server will not pick up the change.

On Vercel:

```bash
npx vercel env add NEXT_PUBLIC_GA_MEASUREMENT_ID production
```

Then redeploy. The variable must exist at **build** time, not just at runtime.

## What gets tracked

`page_view` fires automatically — once from the tag itself on first load, then
from `components/PageViewTracker.tsx` on each client-side navigation.

| Event | Fires when | Parameters |
|---|---|---|
| `app_download` | A download button is clicked, after the download is recorded | `app_name`, `app_category`, `version` |
| `app_favorited` | An app is **added** to favourites and the write succeeded | `app_name`, `app_id` |
| `blog_post_view` | A blog post page is opened | `post_title`, `post_category` |
| `user_signup` | A signup succeeds | `signup_method` (`"email"`) |
| `app_search` | A catalogue search settles (800ms after typing stops) | `search_query`, `results_count` |
| `filter_applied` | A category, Android, sort or source filter changes | `filter_type`, `filter_value` |

Some deliberate choices worth knowing, because they affect how the numbers read:

- **Search is debounced.** Typing "browser" sends one event, not seven.
- **Favourites count adds only**, not removals, and only after the database
  write succeeds — the provider rolls back optimistic updates on failure.
- **Filters skip the first render**, so arriving on a shared
  `/?category=Games` link does not report a filter the visitor never applied.
  Clearing a filter is not counted as applying one.
- **Signup fires before email confirmation.** The account exists at that point;
  waiting would undercount everyone who never clicks the confirmation link.

## User-ID

Signed-in visitors get GA4's User-ID set to their Supabase UUID, which ties
sessions together across devices. The UUID is opaque — **no email address or
username is ever sent to Google.** The event parameter list in `lib/gtag.ts` is
a closed TypeScript union with no field for either, so adding one would be a
deliberate act rather than an accident.

## Verifying

**Locally:** open DevTools → Network, filter for `google-analytics.com`. You
should see `/g/collect` requests on page load and on each tracked action. Also
useful:

```js
// In the browser console — every event the tag has queued
window.dataLayer.filter(e => e[0] === "event")
```

**In GA4:** Admin → DebugView shows events in real time from a browser with the
[GA Debugger extension](https://chrome.google.com/webstore/detail/google-analytics-debugger/jnkmfdileelhofjcijamephohjechhna)
enabled. Realtime → Overview shows traffic without the extension, with a delay
of a minute or so.

Custom event parameters need registering as **custom dimensions** (Admin →
Custom definitions) before they appear in standard reports. They are visible in
DebugView and Realtime immediately either way.

## Failure behaviour

Every call goes through `track()` in `lib/gtag.ts`, which no-ops when
`window.gtag` is absent — a missing ID, an ad blocker, or a click that lands
before the script finishes loading. Analytics can never throw into a click
handler and break the thing the user actually clicked. In development, a single
console warning notes that GA is not configured; production stays silent.

## Consent

There is no consent banner. That is fine in much of the world, but **not in the
EEA or UK**, where GDPR treats analytics cookies as requiring consent and
Google's EU User Consent Policy requires a certified Consent Management
Platform for AdSense traffic. If you expect meaningful traffic from those
regions, a CMP needs adding before ads go live.
