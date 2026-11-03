#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Publish your changes: check the site still builds, save them, push to GitHub.
#
#   bash scripts/publish.sh                 asks for a short description
#   bash scripts/publish.sh "New show dates"
#
# Steps (stops safely at the first problem, nothing half-done):
#   1. brings in anything new from GitHub first (never overwrites your work)
#   2. type check + full build, exactly like CI: a broken site is never pushed
#   3. refuses if a secret (API key, .env file) is about to be published
#   4. saves (commits) every change with your description, pushes to main
#
# Written for the bash 3.2 that ships with macOS. Works in Git Bash too.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=''; G=''; Y=''; R=''; N=''; fi
step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
note() { printf '  %s•%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '\n%s✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"
[ -d .git ] || fail "This isn't a git copy of the project ($ROOT)."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LOG="${TMPDIR:-/tmp}/sc-publish.log"

# ── 1. what changed, and sync with GitHub ────────────────────────────────────
step "Your changes"
if [ -z "$(git status --porcelain)" ]; then
  ok "nothing to publish: everything is already on GitHub"
  exit 0
fi
git status --short | sed 's/^/  /'

if [ "$BRANCH" != "main" ]; then
  note "you're on branch '$BRANCH', not main"
  printf '  Publish this branch instead of main? [y/N] '
  read -r ans || ans=""
  case "$ans" in y|Y|yes) ;; *) fail "Stopped. Switch with:  git switch main" ;; esac
fi

step "Getting the latest from GitHub"
git fetch --quiet origin
if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH")"
  if [ "$BEHIND" -gt 0 ]; then
    # Bring in others' changes without touching yours (stash, fast-forward, restore).
    git stash push --include-untracked --quiet -m "publish.sh autostash"
    if ! git merge --ff-only --quiet "origin/$BRANCH"; then
      git stash pop --quiet || true
      fail "Your copy and GitHub have both changed in different ways. Ask Dillon to help merge."
    fi
    if ! git stash pop --quiet; then
      fail "Your changes overlap with new changes from GitHub (conflict). Nothing was published. Ask Dillon to help; your work is safe in 'git stash list'."
    fi
    ok "brought in $BEHIND new change(s) from GitHub"
  else
    ok "already up to date"
  fi
fi

# ── 2. the site must still build (same checks as CI) ─────────────────────────
step "Checking the site builds"
if [ -n "${FNM_DIR:-}" ] || command -v fnm >/dev/null 2>&1; then eval "$(fnm env --shell bash 2>/dev/null)" >/dev/null 2>&1 || true; fi
command -v npm >/dev/null 2>&1 || fail "npm not found. Run scripts/setup-mac.sh first, then open a new Terminal window."
(
  cd apps/web
  [ -d node_modules ] || npm ci --no-fund --no-audit >"$LOG" 2>&1
  npx astro check >"$LOG" 2>&1 || { tail -30 "$LOG"; exit 1; }
  npx astro build >>"$LOG" 2>&1 || { tail -30 "$LOG"; exit 1; }
) || fail "The site doesn't build with these changes, so nothing was published. The error is above (full log: $LOG)."
ok "type check and build passed"

# ── 3. never publish secrets ─────────────────────────────────────────────────
step "Checking for secrets"
git add -A
BAD_FILES="$(git diff --cached --name-only | grep -E '(^|/)\.env(\..+)?$|\.dev\.vars$|\.pem$|\.p12$|\.key$' | grep -v '\.env\.example$' || true)"
KEY_HITS="$(git diff --cached -U0 | grep -E '^\+' | grep -nE '(sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|re_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{40,})' || true)"
if [ -n "$BAD_FILES" ] || [ -n "$KEY_HITS" ]; then
  git reset --quiet
  [ -n "$BAD_FILES" ] && printf '  secret files: %s\n' "$BAD_FILES"
  [ -n "$KEY_HITS" ] && note "a line looks like an API key or private key"
  fail "Stopped: that looks like a secret. Keys belong in apps/web/.env (never published) or Cloudflare secrets, not in the project."
fi
ok "no secrets"

# ── 4. save and push ─────────────────────────────────────────────────────────
step "Publishing"
MSG="${1:-}"
if [ -z "$MSG" ]; then
  printf '  Describe the change in a few words (e.g. "Add March show dates"): '
  read -r MSG || MSG=""
fi
[ -n "$MSG" ] || { git reset --quiet; fail "A short description is needed."; }
git commit --quiet -m "$MSG"
git push --quiet origin "$BRANCH"
ok "pushed to GitHub ($BRANCH): $(git log -1 --format='%h %s')"

REMOTE="$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')"
cat <<EOF

${G}${B}Published.${N} GitHub now runs the same checks (Actions tab):
  $REMOTE/actions
EOF
