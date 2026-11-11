#!/bin/bash
# Behavior checks for scripts/publish.sh, run in a throwaway repo with a stub npm.
#   bash scripts/test_publish.sh
# Covers: a normal publish reaches the remote; a failing check, a secret file, an
# API-key line and an oversized file each stop with nothing committed or pushed.
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/publish.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0; failed=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else failed=$((failed+1)); echo "  FAIL $1 (expected '$3', got '$2')"; fi; }

# Stub npm: `npm run verify` exits with $VERIFY_EXIT (default 0); everything else succeeds.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/npm" <<'EOF'
#!/bin/bash
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
  echo '{}' >apps/web/node_modules/.package-lock.json
  touch -t 203001010000 apps/web/node_modules/.package-lock.json # install is newer: no npm ci
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

echo "$pass passed, $failed failed"
[ "$failed" = 0 ]
