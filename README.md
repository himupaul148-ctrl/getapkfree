# GetApkFree.com

An open-source Android APK catalogue built with Next.js and Supabase.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (Postgres + Row Level Security + Auth)

## Getting started

```bash
npm install
npm run dev
```

Create a `.env.local` with your Supabase project credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
```

The API URL is the project's `*.supabase.co` host — not the
`supabase.com/dashboard/project/...` URL shown in the dashboard address bar.

## Supabase clients

Three entry points, deliberately separate:

| Module | Use |
| --- | --- |
| `lib/supabase/public.ts` | Cookie-less reads of the public catalogue |
| `lib/supabase/server.ts` | Server components and route handlers, carries the auth cookie |
| `lib/supabase/client.ts` | Browser components (favourites, downloads, settings) |

`proxy.ts` (the Next 16 replacement for `middleware.ts`) refreshes the auth
token on every page request and gates `/profile`. It is an optimistic check
only — `/profile` re-verifies the user server-side, because proxy must not be
treated as an authorization boundary.

## Data model

| Table | Purpose |
| --- | --- |
| `apps` | Metadata, `download_count`, `screenshots`, mock `rating` |
| `versions` | Builds, with scan status, scan date, `permissions`, published flag |
| `users` | Profile keyed to `auth.users(id)`, plus theme and notification prefs |
| `downloads` | Download log, nullable `user_id` for anonymous downloads |
| `favorites` | Per-user saved apps, unique on `(user_id, app_id)` |

Two triggers do the bookkeeping:

- `on_auth_user_created` creates the `public.users` row on signup, taking the
  username from signup metadata and de-duplicating it so a clash can never roll
  back the signup.
- `downloads_bump_count` keeps `apps.download_count` in step with the event
  log, so the counter and the rows cannot drift apart.

Permissions live on `versions` rather than `apps` because they legitimately
change between builds.

## Security model

The publishable key ships to the browser, so Row Level Security is the actual
access control:

- `apps` — readable by everyone
- `versions` — readable **only where `published = true`**, so unscanned or
  flagged builds never reach the public site
- `users`, `downloads`, `favorites` — scoped to the owning account via
  `auth.uid()`

There is no anonymous write path to `apps` or `versions`. The only public RPC is
`is_username_available(text)`, which the signup form needs and which returns a
boolean rather than exposing `public.users`. Trigger functions have `EXECUTE`
revoked so they are not reachable over the REST API.

## Auth notes

Email confirmation is **enabled** on this project, so `signUp` returns no
session and the user must click the emailed link, which lands on
`/auth/callback`. To allow instant signup while developing, turn off
"Confirm email" under Authentication → Sign In / Providers → Email in the
Supabase dashboard.

## Theming

Dark is the default. `app/globals.css` defines the palette twice — once on
`:root` and once on `:root[data-theme="light"]` — and `@theme inline` makes the
Tailwind utilities resolve through those variables, so no class names change.
The light greens and blues are darker than their dark-theme counterparts to
hold 4.5:1 contrast on a pale background. `components/ThemeScript.tsx` applies
the stored choice before first paint to avoid a flash.

## Homepage filters

Search, category, Android level and sort all live in one client context
(`components/catalogue/FilterProvider.tsx`). The category cards and the
catalogue dropdowns both read from it, so a selection made in either place
shows up in the other rather than the two drifting apart.

State is mirrored into the URL with `replaceState`, so a filtered view is
bookmarkable and shareable:

```
/?search=note&category=Productivity&android=9.0&sort=rating
```

`search` is the current param; `q` is still read as an alias for older links.
`category` is matched case-insensitively, so `productivity` works too.

| Sort | Order |
| --- | --- |
| Trending | Downloads damped by days since the last build |
| Newest | `apps.created_at` |
| Most downloaded | `apps.download_count` |
| Highest rated | `apps.rating`, ties broken by `rating_count` |
| Recently updated | Newest published build |

The Android options are a fixed 8.0–12.0 ladder rather than whatever the data
happens to contain, so they do not shift as apps are added. Picking a level
means "my device runs this", so it lists apps whose minimum is at or below it.

Below `md` the three dropdowns collapse into a Filters drawer with a badge for
the active count; the search box stays in place at every width.

## Admin panel

`/admin` is gated twice. `proxy.ts` keeps anonymous visitors out (so the
sign-in redirect carries them back), and `app/admin/layout.tsx` checks the
admin flag server-side and sends non-admins to the homepage rather than
showing a 403.

Neither of those is the real guard. RLS is:

- `public.admin_emails` lists who may administer. It has RLS on and **no
  policies**, so it is unreachable over the REST API and readable only by the
  definer functions.
- `handle_new_user()` sets `users.is_admin` when a listed address signs up.
- `public.is_admin()` is `SECURITY DEFINER` so it does not recurse through
  `public.users` own RLS when called from a policy on another table.
- `apps` and `versions` have `FOR ALL` policies predicated on it, and admins
  get an extra SELECT policy so they can see unpublished builds.
- The self-update policy on `users` pins `is_admin` to its current value, so
  nobody can promote themselves.

### Uploads

The browser uploads the APK **straight to Supabase Storage**, never through
this app. Vercel caps serverless request bodies at 4.5 MB, so routing a real
APK through a route handler would fail on anything sizeable. Only the resulting
storage URL is POSTed to `/api/admin/parse-apk`, which fetches and parses it
server-side (Node runtime — the parser needs Buffer and zlib).

That route only accepts URLs under this project own `apks` bucket, so it
cannot be used as a general-purpose fetch proxy.

Metadata extraction is best-effort: if the manifest cannot be read the form
says so and falls back to manual entry rather than failing the upload.
Publishing requires the "scanned & safe" box; a draft does not.

## Sample data

48 fictional apps, six in each of the eight categories. Their `file_url` values
point at the reserved `.invalid` TLD (RFC 2606) and can never resolve — no real
APK binaries are hosted or linked. Ratings are mock values derived from each
slug so they stay stable.
