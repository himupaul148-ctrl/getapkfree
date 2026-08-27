# deploy-workflow

Commits everything and pushes it to `main` in one command.

## Running it

```bash
npm run deploy-workflow
```

Or directly, which is the same thing:

```bash
bash scripts/deploy-workflow.sh
```

To use a different commit message:

```bash
bash scripts/deploy-workflow.sh "Fix the privacy post typo"
```

## What it does

1. Checks git is installed.
2. Checks you are in a git repository, and moves to its root so `git add .`
   means the whole project rather than whichever folder you happened to be in.
3. Checks you are on `main`.
4. Stages everything with `git add .` and lists what it staged.
5. Scans the staged diff for secrets and stops if it finds one.
6. Commits with `Add GitHub Actions blog auto-publish workflow`, or your own
   message.
7. Pushes to `origin main`.

Output looks like this:

```
Deploying to GitHub

→ Checking git is installed...
✓ git 2.55.0
→ Checking this is a git repository...
✓ Repository: /home/you/apk
→ Checking the current branch...
✓ On main
→ Staging changes...
✓ Staged 2 file(s)
     blog-posts/new-post.md
     package.json
→ Checking for secrets...
✓ No secrets detected
→ Committing files...
✓ Committed: Add GitHub Actions blog auto-publish workflow
   a1b2c3d
→ Pushing to GitHub...
   main -> main

✓ Workflow deployed to GitHub! Posts will auto-publish when you push to /blog-posts/
```

## Why the secret check

`git add .` stages everything, including files you did not mean to add. This
repository holds a Supabase service role key, a VirusTotal key and a blog
publish token in `.env.local`. `.gitignore` covers `.env*`, but a renamed file
or a key pasted into a source file while debugging would go straight through —
and a secret pushed to a repository is not really recoverable, because it stays
in the history even after you delete it.

So before committing, the script looks for `.env` files and for key-shaped
strings in the diff. If it finds one it **unstages everything and stops**,
leaving your files untouched.

## If it fails

Every failure names the step it happened in and prints git's own error, so
there is no guessing.

**`Git is not installed`** — install from
[git-scm.com/downloads](https://git-scm.com/downloads) and reopen your
terminal so it lands on your `PATH`.

**`Not in a git repository`** — you are outside the project. `cd` to the folder
containing `.git` and try again.

**`You are on 'some-branch', not 'main'`** — the script only pushes `main`.
Running `git push origin main` from another branch pushes the local `main`
ref, not the work you just committed, which looks like success but changes
nothing. Switch with `git checkout main`, or merge your branch first.

**`An .env file was staged`** — something matching `.env` was about to be
committed. Everything has been unstaged. Confirm `.gitignore` covers it:

```bash
git check-ignore -v .env.local
```

**`What looks like a live secret is in the diff`** — a key-shaped string is in
your changes. Everything has been unstaged. Find it with:

```bash
git diff | grep -nE 'sb_secret_|re_[A-Za-z0-9]{24}|SERVICE_ROLE|PUBLISH_TOKEN'
```

Move it to `.env.local` and read it with `process.env`.

**`Push failed`, then `rejected — non-fast-forward`** — the remote has
commits you do not. Pull first:

```bash
git pull --rebase origin main
npm run deploy-workflow
```

**`Push failed`, then an authentication error** — your git credentials
have expired. Sign in again with the
[GitHub CLI](https://cli.github.com/) (`gh auth login`) or update the token in
your credential manager.

The commit is made *before* the push, so a failed push leaves your work
committed locally. Fix whatever it complained about and run the command again —
it will push the existing commit.

**Nothing happened, it said "already up to date"** — there were no changes to
commit. The script still tries a push in case you had local commits that were
never pushed.

## Related

- [BLOG_POSTING.md](BLOG_POSTING.md) — writing and publishing blog posts
- [docs/analytics.md](docs/analytics.md) — GA4 setup
