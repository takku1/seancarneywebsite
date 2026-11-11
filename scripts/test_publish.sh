#!/bin/bash
# Behavior checks for scripts/publish.sh, run in a throwaway repo with a stub npm.
#   bash scripts/test_publish.sh
# Covers: a normal publish reaches the remote; a failing check, a secret file, an
# API-key line and an oversized file each stop with nothing committed or pushed;
# packages reinstall only when the lockfile content changed; saved-but-unpushed
# commits are checked and pushed; an unrelated stash is never touched.
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/publish.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0; failed=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else failed=$((failed+1)); echo "  FAIL $1 (expected '$3', got '$2')"; fi; }

# Stub npm: logs each call; `npm run verify` exits with $VERIFY_EXIT (default 0).
mkdir -p "$WORK/bin"
export NPM_LOG="$WORK/npm.log"
cat >"$WORK/bin/npm" <<'EOF'
#!/bin/bash
echo "$1" >>"$NPM_LOG"
[ "$1 $2" = "run verify" ] && exit "${VERIFY_EXIT:-0}"
exit 0
EOF
chmod +x "$WORK/bin/npm"
export PATH="$WORK/bin:$PATH"

setup() {
  rm -rf "$WORK/remote.git" "$WORK/repo"
  git init --quiet --bare -b main "$WORK/remote.git"
  git init --quiet -b main "$WORK/repo"
  cd "$WORK/repo" || exit 1
  git config user.email t@example.com; git config user.name test
  mkdir -p scripts apps/web/node_modules
  cp "$SRC" scripts/publish.sh
  echo '{}' >apps/web/package-lock.json
  git hash-object apps/web/package-lock.json >apps/web/node_modules/.publish-lock-hash # installed from this lockfile
  : >"$NPM_LOG"
  printf 'node_modules/\n' >.gitignore
  git add -A && git commit --quiet -m init
  git remote add origin "$WORK/remote.git" && git push --quiet origin main
}
remote_head() { git --git-dir="$WORK/remote.git" log -1 --format=%s main; }
commits() { git rev-list --count HEAD; }

echo "publish.sh"
setup; echo "hello" >page.txt
bash scripts/publish.sh "Add page" </dev/null >/dev/null 2>&1
check "a clean change is committed and pushed" "$(remote_head)" "Add page"

setup; echo "hello" >page.txt
VERIFY_EXIT=1 bash scripts/publish.sh "Broken" </dev/null >/dev/null 2>&1
check "a failing check publishes nothing" "$(commits):$(remote_head)" "1:init"

setup; echo "KEY=1" >apps/web/.env
bash scripts/publish.sh "Oops" </dev/null >/dev/null 2>&1
check "a .env file is refused" "$(commits):$(git diff --cached --name-only | wc -l | tr -d ' ')" "1:0"

setup; echo "token = sk-ant-api03-abcdefghijklmnopqrstuvwxyz" >notes.txt
bash scripts/publish.sh "Oops" </dev/null >/dev/null 2>&1
check "an API key in a file is refused" "$(commits)" "1"

setup; head -c $((26 * 1024 * 1024)) /dev/zero >big.bin
bash scripts/publish.sh "Big" </dev/null >/dev/null 2>&1
check "a file over 25 MB is refused" "$(commits)" "1"

setup; echo "hello" >page.txt
bash scripts/publish.sh --check </dev/null >/dev/null 2>&1
check "--check saves nothing" "$(commits):$(git status --porcelain | wc -l | tr -d ' ')" "1:1"

setup; echo "hello" >page.txt
bash scripts/publish.sh "Edit" </dev/null >/dev/null 2>&1
check "an unchanged lockfile skips npm ci" "$(grep -cx 'ci' "$NPM_LOG")" "0"

setup; echo '{"changed":1}' >apps/web/package-lock.json
bash scripts/publish.sh "Bump" </dev/null >/dev/null 2>&1
check "a changed lockfile runs npm ci" "$(grep -cx 'ci' "$NPM_LOG")" "1"

setup; echo "saved" >later.txt; git add -A; git commit --quiet -m "Saved offline"
bash scripts/publish.sh </dev/null >/dev/null 2>&1
check "a saved-but-unpushed commit is pushed" "$(remote_head)" "Saved offline"

setup; echo "KEY=1" >apps/web/.env; git add -f apps/web/.env; git commit --quiet -m "Oops offline"
bash scripts/publish.sh </dev/null >/dev/null 2>&1
check "an unpushed commit with a secret is not pushed" "$(remote_head)" "init"

# GitHub moved on while a local commit waited: the histories diverged, so the sync
# step runs on a clean tree. It must stop without popping an unrelated older stash.
setup; echo "draft" >draft.txt; git stash push --include-untracked --quiet -m older
git clone --quiet "$WORK/remote.git" "$WORK/other" && (cd "$WORK/other" && git config user.email o@example.com && git config user.name other && echo x >remote.txt && git add -A && git commit --quiet -m "Elsewhere" && git push --quiet origin main); rm -rf "$WORK/other"
echo "saved" >later.txt; git add -A; git commit --quiet -m "Saved"
bash scripts/publish.sh </dev/null >/dev/null 2>&1
check "diverged history stops, leaving an older stash alone" "$(remote_head):$(git stash list | wc -l | tr -d ' '):$([ -f draft.txt ] && echo popped || echo kept)" "Elsewhere:1:kept"

echo "$pass passed, $failed failed"
[ "$failed" = 0 ]
