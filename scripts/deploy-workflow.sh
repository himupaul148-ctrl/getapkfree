#!/usr/bin/env bash
#
# Commit everything and push to main.
#
#   npm run deploy-workflow
#   bash scripts/deploy-workflow.sh
#   bash scripts/deploy-workflow.sh "A different commit message"
#
# Works on Git Bash (Windows), macOS and Linux.
#
set -uo pipefail

DEFAULT_MESSAGE="Add GitHub Actions blog auto-publish workflow"
MESSAGE="${1:-$DEFAULT_MESSAGE}"
BRANCH="main"
REMOTE="origin"

# Colour only when writing to a terminal, so piping to a file stays readable.
if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BLUE=$'\033[36m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; DIM=''; OFF=''
fi

STEP=""

step()  { STEP="$1"; printf '%s→ %s%s\n' "$BLUE" "$1" "$OFF"; }
ok()    { printf '%s✓ %s%s\n' "$GREEN" "$1" "$OFF"; }
note()  { printf '%s   %s%s\n' "$DIM" "$1" "$OFF"; }
warn()  { printf '%s! %s%s\n' "$YELLOW" "$1" "$OFF"; }

# Every exit path names the step that failed, so a failure is never mysterious.
fail() {
  printf '\n%s✗ %s%s\n' "$RED" "$1" "$OFF" >&2
  [ -n "$STEP" ] && printf '%s  Failed during: %s%s\n' "$RED" "$STEP" "$OFF" >&2
  [ -n "${2:-}" ] && printf '\n%s\n' "$2" >&2
  exit 1
}

printf '\n%sDeploying to GitHub%s\n\n' "$BLUE" "$OFF"

# ---- 1. git installed ----------------------------------------------------

step "Checking git is installed..."
command -v git >/dev/null 2>&1 || fail \
  "Git is not installed" \
  "Install it from https://git-scm.com/downloads, then run this again."
ok "git $(git --version | awk '{print $3}')"

# ---- 2. inside a git repository ------------------------------------------

step "Checking this is a git repository..."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail \
  "Not in a git repository" \
  "Run this from the project root, where the .git folder lives."

# Work from the repo root wherever the script was invoked, so `git add .`
# always means the whole project rather than one subdirectory.
cd "$(git rev-parse --show-toplevel)" || fail "Could not enter the repository root"
ok "Repository: $(pwd)"

# ---- 3. on the right branch ----------------------------------------------

step "Checking the current branch..."
current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ]; then
  # `git push origin main` from another branch pushes the local main ref, not
  # the work just committed — a silent no-op that looks like success.
  fail "You are on '$current', not '$BRANCH'" \
    "Switch first:  git checkout $BRANCH"
fi
ok "On $BRANCH"

# ---- 4. stage ------------------------------------------------------------

step "Staging changes..."
if [ -z "$(git status --porcelain)" ]; then
  ok "Nothing to commit — the working tree is already clean"
  note "Checking whether local commits still need pushing."
  if ! push_output=$(git push "$REMOTE" "$BRANCH" 2>&1); then
    fail "Push failed" "$push_output"
  fi
  printf '\n%s✓ Already up to date with %s/%s.%s\n\n' "$GREEN" "$REMOTE" "$BRANCH" "$OFF"
  exit 0
fi

git add . || fail "Could not stage changes"
count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
ok "Staged $count file(s)"
git diff --cached --name-only | sed "s/^/${DIM}     /;s/\$/${OFF}/"

# ---- 5. refuse to push secrets -------------------------------------------
#
# `git add .` is indiscriminate. .gitignore covers .env* today, but a renamed
# file or a key pasted into a source file would sail straight through — and a
# secret is not really recoverable once it is in a repository's history.

step "Checking for secrets..."
unstage() { git restore --staged . 2>/dev/null || git reset -q; }

if git diff --cached --name-only | grep -Eq '(^|/)\.env'; then
  unstage
  fail "An .env file was staged" \
    "Everything has been unstaged. Check .gitignore covers it, then retry."
fi

# This script and its documentation quote the very patterns being searched
# for, so scanning them would flag every change to the scanner itself. Nothing
# else is exempt.
if git diff --cached -- . \
     ':(exclude)scripts/deploy-workflow.sh' \
     ':(exclude)DEPLOY_WORKFLOW.md' \
   | grep -Eq 'sb_secret_|re_[A-Za-z0-9]{24}|(SUPABASE_SERVICE_ROLE_KEY|BLOG_PUBLISH_TOKEN|VIRUSTOTAL_API_KEY)[[:space:]]*[=:][[:space:]]*["'\'']?[A-Za-z0-9_.-]{16}'; then
  unstage
  fail "What looks like a live secret is in the diff" \
    "Everything has been unstaged. Review the change, then retry."
fi
ok "No secrets detected"

# ---- 6. commit -----------------------------------------------------------

step "Committing files..."
if ! commit_output=$(git commit -m "$MESSAGE" 2>&1); then
  fail "Commit failed" "$commit_output"
fi
ok "Committed: $MESSAGE"
note "$(git rev-parse --short HEAD)"

# ---- 7. push -------------------------------------------------------------

step "Pushing to GitHub..."
if ! push_output=$(git push "$REMOTE" "$BRANCH" 2>&1); then
  fail "Push failed" "$push_output"
fi
printf '%s%s%s\n' "$DIM" "$push_output" "$OFF"

# ---- done ----------------------------------------------------------------

printf '\n%s✓ Workflow deployed to GitHub! Posts will auto-publish when you push to /blog-posts/%s\n\n' \
  "$GREEN" "$OFF"

url="$(git remote get-url "$REMOTE" 2>/dev/null || true)"
if [ -n "$url" ]; then
  # Normalise either remote form into a browsable https URL.
  web="${url%.git}"
  web="${web/git@github.com:/https://github.com/}"
  case "$web" in
    https://*) note "Actions: ${web}/actions" ;;
  esac
fi

warn "Vercel builds from this push — give it a minute before checking the site."
printf '\n'
