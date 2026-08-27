# Publishing blog posts from git

Drop a markdown file in `blog-posts/`, push it, and it appears at
`/blog/<slug>` within a minute or two. No admin panel, no manual step.

The admin editor at `/admin/blog` still works and is better for a quick edit
or a draft. This route is for writing in your own editor and keeping posts in
version control.

---

## One-time setup

The workflow needs a token so it can publish. **Not** your Supabase service
role key — that key bypasses every security policy on every table, and anything
with repo access could read it. This token can create a blog post and nothing
else.

**1. Generate a token.** Any long random string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**2. Add it to Vercel** so the site will accept it:

```bash
npx vercel env add BLOG_PUBLISH_TOKEN production
```

Paste the value when prompted, then redeploy so it takes effect.

**3. Add the same value to GitHub.** Repository → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**.

- Name: `BLOG_PUBLISH_TOKEN`
- Value: the same string

**4. Optional — a custom domain.** The workflow defaults to
`https://getapkfree.vercel.app`. When `getapkfree.com` is live, add a
repository *variable* (not a secret) called `SITE_URL` with the new origin.

---

## Writing a post

Create `blog-posts/your-post-slug.md`:

```markdown
---
title: "Best Privacy Apps for Android"
slug: "best-privacy-apps-android"
description: "A short summary for search results. Keep it under 160 characters."
category: "privacy"
author: "GetApkFree Team"
featured_image_url: "https://example.com/cover.png"
related_app_ids: ["uuid-1", "uuid-2", "uuid-3"]
---

## Your first heading

Write the body in normal markdown. **Bold**, _italic_, [links](/app/some-slug),
lists, tables and fenced code blocks all work.
```

### The fields

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Shown as the `<h1>` and the page title. |
| `slug` | yes | Lowercase words joined by hyphens. Becomes `/blog/<slug>`. |
| `description` | yes | The search snippet and card excerpt. **200 characters max**, and search engines truncate around 160. |
| `category` | yes | One of `privacy`, `productivity`, `gaming`, `tools`, `guides`, `news`. |
| `author` | no | Defaults to `GetApkFree Team`. |
| `featured_image_url` | no | Card and hero image. 16:9 looks best. |
| `related_app_ids` | no | App UUIDs for the sidebar, in the order you want them shown. Leave it out and the sidebar falls back to trending apps. |
| `published` | no | Defaults to `true`. Set `published: false` to push a draft that stays hidden. |

### Finding app UUIDs

Open `/admin/blog`, start a post in the **Write** tab, and use the related-apps
search — it shows the catalogue by name. Or query directly:

```sql
select id, name from apps where name ilike '%signal%';
```

### Formatting notes

The body is rendered through the same sanitiser the admin editor uses. Standard
markdown works, including GFM tables and task lists. **Raw HTML is stripped** —
`<script>`, `onclick` and `javascript:` links will not survive, by design.

Link to app pages with normal relative links: `[Signal](/app/signal)`. That is
the point of a post here, so use them.

---

## Publishing

```bash
git checkout -b post/best-privacy-apps
git add blog-posts/best-privacy-apps-android.md
git commit -m "Add privacy apps post"
git push -u origin post/best-privacy-apps
```

**On a branch or pull request**, the workflow only *validates* — it parses the
frontmatter and comments that the post looks fine, without publishing. That way
a typo is caught before anything goes live.

**On a push to `main`**, it publishes and comments with the live URL:

> ✓ Published: https://getapkfree.vercel.app/blog/best-privacy-apps-android *(created)*

You can push several posts in one commit; all of them publish.

### Editing a published post

Change the file and push again. Posts are matched on `slug`, so the existing
post is updated in place rather than duplicated. The comment says *(updated)*.

### Republishing everything

Actions → **Publish blog posts** → **Run workflow**, tick "Publish every post".
Useful after an outage.

---

## Verifying

1. **Actions tab** — the run should be green. The job summary lists what
   published.
2. **The commit or PR** carries a comment with the URL.
3. **Visit the URL.** The post is live immediately; the workflow clears the
   cached listing rather than waiting for the hourly window.
4. `/blog` shows the new card, and `/sitemap.xml` includes the URL.

Check a post parses before pushing:

```bash
DRY_RUN=1 node scripts/publish-blog-posts.mjs blog-posts/your-post.md
```

That validates the frontmatter without touching the database.

---

## Troubleshooting

**"BLOG_PUBLISH_TOKEN is not set"** — the GitHub secret is missing. Step 3
above.

**401 Not authorised** — the secret and the Vercel variable do not match, or
Vercel has not been redeployed since the variable was added. `NEXT_PUBLIC_*`
aside, env changes need a redeploy.

**"no frontmatter found"** — the file must *start* with `---` on line 1. A
blank line or a BOM before it breaks the match. The parser strips a BOM but not
leading blank lines.

**`category "..." is not one of`** — check spelling and use lowercase. The six
valid values are listed in the table above.

**`slug "..." must be lowercase words joined by hyphens`** — no spaces,
capitals, underscores or trailing hyphens. `best-privacy-apps`, not
`Best Privacy Apps`.

**`description is 214 characters, limit 200`** — the database enforces this.
Trim it.

**`"related_app_ids" opens a [ list but does not close it`** — write lists
inline on one line: `["a", "b"]`. Multi-line YAML lists are not supported.

**The workflow did not run at all** — it only triggers on `blog-posts/**.md`.
A file elsewhere, or with a different extension, is ignored.

**A post published but the sidebar apps are missing** — the UUIDs do not match
any app. Nothing breaks; the sidebar falls back to trending. Re-check the ids.

### What deleting a file does *not* do

Removing a markdown file does **not** unpublish the post — the workflow only
looks at added and modified files. This is deliberate: a rename or a
reorganisation should not silently take live posts down. To unpublish, set
`published: false` in the file and push, or use `/admin/blog`.
