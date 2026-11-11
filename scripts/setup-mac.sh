#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Sean Carney website: one-time Mac setup.
#
# Installs everything needed to run, edit and deploy the site, then gets the
# project running locally. Safe to re-run: every step checks first and skips
# what is already done. Never overwrites your .env.
#
#   Assumes a brand-new Mac with nothing configured. Sets up:
#             Xcode Command Line Tools, Homebrew, git, GitHub CLI (gh) + sign-in,
#             git name/email, fnm (Node version manager) + Node 24 (same as CI),
#             the project itself and its packages
#   Needs:    macOS 13.5+, a GitHub account with access to the (private) repo
#   Optional: --extras     VS Code, ffmpeg (video cuts)
#             --cloudflare wrangler login (only needed to deploy)
#
# Usage (Terminal):
#   From a copy of the repo:   bash scripts/setup-mac.sh
#   On a fresh Mac:            download setup-mac.sh (GitHub > scripts > setup-mac.sh > Download raw file),
#                              then:  bash ~/Downloads/setup-mac.sh
#   Don't pipe it into bash (curl ... | bash): the installers ask questions and need the keyboard.
#
# Options:
#   --dir PATH      where to clone the project (default: ~/Code/seancarneywebsite)
#   --extras        also install VS Code and ffmpeg
#   --cloudflare    also log in to Cloudflare (wrangler), for deploying
#   --no-login      skip the GitHub sign-in (repo must already be cloned)
#   --dry-run       print what would happen, change nothing
#   -h, --help      show this help
#
# Written for the bash 3.2 that ships with macOS.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/takku1/seancarneywebsite.git"
REPO_SLUG="takku1/seancarneywebsite"
NODE_MAJOR="24"
TARGET_DIR="$HOME/Code/seancarneywebsite"
EXTRAS=0
CLOUDFLARE=0
LOGIN=1
DRY_RUN=0

# ── output helpers ───────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B=''; G=''; Y=''; R=''; D=''; N=''; fi
step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
note() { printf '  %s•%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '\n%s✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry-run]%s %s\n' "$D" "$N" "$*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }
# Append a line to a shell profile once.
add_line() { # file, line
  local file="$1" line="$2"
  if [ -f "$file" ] && grep -qF "$line" "$file"; then return 0; fi
  if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry-run]%s append to %s: %s\n' "$D" "$N" "$file" "$line"; return 0; fi
  printf '\n%s\n' "$line" >> "$file"
  note "added to $(basename "$file"): $line"
}

usage() {
  cat <<'HELP'
Sean Carney website: Mac setup
  bash setup-mac.sh [--dir PATH] [--extras] [--cloudflare] [--no-login] [--dry-run]

  --dir PATH    where to put the project (default: ~/Code/seancarneywebsite)
  --extras      also install VS Code and ffmpeg
  --cloudflare  also log in to Cloudflare (only needed to deploy)
  --no-login    skip the GitHub sign-in (project already downloaded)
  --dry-run     show what would happen, change nothing
HELP
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || fail "--dir needs a path"; TARGET_DIR="$2"; shift 2 ;;
    --extras) EXTRAS=1; shift ;;
    --cloudflare) CLOUDFLARE=1; shift ;;
    --no-login) LOGIN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) fail "Unknown option: $1 (try --help)" ;;
  esac
done

# ── 0. preflight ─────────────────────────────────────────────────────────────
if [ ! -t 0 ] && [ "$DRY_RUN" = 0 ]; then
  fail "Run this from a Terminal window: download the script, then run  bash setup-mac.sh  (piping it into bash breaks the installers' prompts)."
fi
step "Checking this Mac"
if [ "$(uname -s)" != "Darwin" ] && [ "${SC_SETUP_ALLOW_NON_MAC:-0}" != 1 ]; then fail "This script is for macOS."; fi
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then BREW_PREFIX="/opt/homebrew"; else BREW_PREFIX="/usr/local"; fi
MACOS="$(sw_vers -productVersion 2>/dev/null || echo 0)"
MAC_MAJOR="${MACOS%%.*}"; MAC_MINOR="$(echo "$MACOS" | cut -d. -f2)"; MAC_MINOR="${MAC_MINOR:-0}"
if [ "${SC_SETUP_ALLOW_NON_MAC:-0}" != 1 ]; then
  if [ "$MAC_MAJOR" -lt 13 ] || { [ "$MAC_MAJOR" -eq 13 ] && [ "$MAC_MINOR" -lt 5 ]; }; then
    fail "macOS $MACOS is too old: Node $NODE_MAJOR needs macOS 13.5 or newer. Update macOS (System Settings > General > Software Update), then run this again."
  fi
fi
ok "macOS $MACOS on $ARCH"
[ "$(id -u)" -ne 0 ] || fail "Run this as your normal user, not with sudo."
ZPROFILE="$HOME/.zprofile"
ZSHRC="$HOME/.zshrc"

# If we're inside a copy of the repo already, use it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
REPO_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../apps/web/package.json" ]; then
  REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  ok "using the project at $REPO_DIR"
fi

# ── 1. Xcode Command Line Tools (compilers + git that Homebrew needs) ────────
step "Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  ok "installed"
else
  note "a macOS window will ask to install the tools. Click Install and wait for it to finish."
  run xcode-select --install || true
  if [ "$DRY_RUN" = 0 ]; then
    printf '  waiting for the install to finish'
    until xcode-select -p >/dev/null 2>&1; do printf '.'; sleep 10; done
    printf '\n'; ok "installed"
  fi
fi

# ── 2. Homebrew ──────────────────────────────────────────────────────────────
step "Homebrew"
if ! have brew && [ -x "$BREW_PREFIX/bin/brew" ]; then eval "$("$BREW_PREFIX/bin/brew" shellenv)"; fi
if have brew; then
  ok "installed ($(brew --version | head -1))"
else
  note "installing Homebrew (it will ask for your Mac password)"
  if [ "$DRY_RUN" = 1 ]; then
    run /bin/bash -c '"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  else
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$("$BREW_PREFIX/bin/brew" shellenv)"
  fi
fi
add_line "$ZPROFILE" "eval \"\$($BREW_PREFIX/bin/brew shellenv)\""

# ── 3. Command-line tools ────────────────────────────────────────────────────
step "Developer tools"
brew_install() { # formula or --cask name
  local kind="" name="$1"
  if [ "$1" = "--cask" ]; then kind="--cask"; name="$2"; fi
  if [ "$DRY_RUN" = 0 ] && brew list $kind "$name" >/dev/null 2>&1; then ok "$name"; return 0; fi
  if [ -n "$kind" ]; then run brew install --cask "$name"; else run brew install "$name"; fi
  [ "$DRY_RUN" = 1 ] || ok "$name installed"
}
brew_install git
brew_install gh
brew_install fnm
if [ "$EXTRAS" = 1 ]; then
  brew_install ffmpeg
  if [ -d "/Applications/Visual Studio Code.app" ]; then ok "VS Code"; else brew_install --cask visual-studio-code; fi
fi

# ── 4. Node (via fnm, pinned to the same major version as CI) ───────────────
step "Node.js $NODE_MAJOR"
add_line "$ZSHRC" 'eval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell zsh)"'
if [ "$DRY_RUN" = 0 ]; then eval "$(fnm env --shell bash)"; fi
run fnm install "$NODE_MAJOR"
run fnm default "$NODE_MAJOR"
if [ "$DRY_RUN" = 0 ]; then
  fnm use "$NODE_MAJOR" >/dev/null
  ok "node $(node -v), npm $(npm -v)"
fi

# ── 5. GitHub: sign in, check access, identity ───────────────────────────────
step "GitHub"
GH_LOGIN=""
if [ "$LOGIN" = 1 ]; then
  if [ "$DRY_RUN" = 0 ] && gh auth status --hostname github.com >/dev/null 2>&1; then
    ok "signed in to GitHub"
  else
    note "sign in to GitHub in the browser window that opens (no account yet? create one at github.com/signup first)"
    run gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
  fi
  # git uses the GitHub CLI for passwords, so clone/pull/push just work.
  run gh auth setup-git
  if [ "$DRY_RUN" = 0 ]; then
    GH_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
    [ -n "$GH_LOGIN" ] && ok "GitHub account: $GH_LOGIN"
    if ! gh repo view "$REPO_SLUG" --json name >/dev/null 2>&1; then
      fail "Your GitHub account ($GH_LOGIN) can't see $REPO_SLUG yet. Ask Dillon to add you as a collaborator (github.com/$REPO_SLUG/settings/access), accept the invite email, then run this script again."
    fi
    ok "access to $REPO_SLUG"
  fi
fi

# Who commits are from. Without this, git refuses to save changes.
if [ "$DRY_RUN" = 0 ] && [ -z "$(git config --global user.name || true)" ]; then
  default_name="$(gh api user --jq '.name // .login' 2>/dev/null || true)"
  printf '  Your name for saved changes%s: ' "${default_name:+ [$default_name]}"
  read -r gname </dev/tty || gname=""
  gname="${gname:-$default_name}"
  [ -n "$gname" ] || fail "A name is needed for saved changes."
  git config --global user.name "$gname"
fi
if [ "$DRY_RUN" = 0 ] && [ -z "$(git config --global user.email || true)" ]; then
  # GitHub's private no-reply address keeps a personal email out of the project history.
  default_email=""
  gid="$(gh api user --jq .id 2>/dev/null || true)"
  [ -n "$gid" ] && [ -n "$GH_LOGIN" ] && default_email="${gid}+${GH_LOGIN}@users.noreply.github.com"
  printf '  Email for saved changes%s: ' "${default_email:+ [$default_email]}"
  read -r gemail </dev/tty || gemail=""
  gemail="${gemail:-$default_email}"
  [ -n "$gemail" ] || fail "An email is needed for saved changes."
  git config --global user.email "$gemail"
fi
if [ "$DRY_RUN" = 1 ]; then
  run git config --global user.name "<asked once>"
  run git config --global user.email "<asked once; defaults to the GitHub no-reply address>"
else
  ok "git identity: $(git config --global user.name) <$(git config --global user.email)>"
fi
# Sensible defaults, only where nothing is set yet.
git_default() { [ "$DRY_RUN" = 0 ] && [ -n "$(git config --global "$1" || true)" ] && return 0; run git config --global "$1" "$2"; }
git_default init.defaultBranch main
git_default pull.ff only
git_default push.autoSetupRemote true

# ── 6. The project ───────────────────────────────────────────────────────────
step "Project"
if [ -z "$REPO_DIR" ] && [ -f "$TARGET_DIR/apps/web/package.json" ]; then REPO_DIR="$TARGET_DIR"; ok "found the project at $REPO_DIR"; fi
if [ -z "$REPO_DIR" ]; then
  run mkdir -p "$(dirname "$TARGET_DIR")"
  run git clone "$REPO_URL" "$TARGET_DIR"
  REPO_DIR="$TARGET_DIR"
  [ "$DRY_RUN" = 1 ] || ok "downloaded to $REPO_DIR"
elif [ -d "$REPO_DIR/.git" ]; then
  ok "project at $REPO_DIR"
  if [ "$DRY_RUN" = 1 ]; then run git -C "$REPO_DIR" pull --ff-only; else git -C "$REPO_DIR" pull --ff-only >/dev/null 2>&1 && ok "up to date with GitHub" || note "couldn't fast-forward from GitHub (local changes?); leaving it as is"; fi
else
  fail "$REPO_DIR isn't a git copy of the project (was it downloaded as a ZIP?). Move it aside and run this script on its own so it can download a proper copy."
fi
WEB_DIR="$REPO_DIR/apps/web"
# Pre-push gate: unit tests and type check before app changes reach GitHub (CI is manual-only).
if [ "$DRY_RUN" = 1 ]; then run git -C "$REPO_DIR" config core.hooksPath scripts/hooks
else git -C "$REPO_DIR" config core.hooksPath scripts/hooks && ok "pre-push checks on"; fi

# ── 7. Packages ──────────────────────────────────────────────────────────────
step "Installing project packages"
if [ "$DRY_RUN" = 1 ]; then
  run npm ci --prefix "$WEB_DIR"
else
  (cd "$WEB_DIR" && npm ci --no-fund --no-audit)
  ok "packages installed"
fi

# ── 8. Local settings (.env) ─────────────────────────────────────────────────
step "Local settings"
if [ -f "$WEB_DIR/.env" ]; then
  ok ".env already exists (left untouched)"
else
  run cp "$WEB_DIR/.env.example" "$WEB_DIR/.env"
  note "created apps/web/.env from the example. Every key can stay blank: the site runs, and integrations just stay off."
fi

# ── 9. Cloudflare (optional: only for deploying) ─────────────────────────────
if [ "$CLOUDFLARE" = 1 ]; then
  step "Cloudflare"
  note "a browser window will ask you to allow Wrangler"
  if [ "$DRY_RUN" = 1 ]; then run npx --prefix "$WEB_DIR" wrangler login; else (cd "$WEB_DIR" && npx wrangler login); fi
fi

# ── 10. Verify ────────────────────────────────────────────────────────────────
step "Checking the project builds"
if [ "$DRY_RUN" = 1 ]; then
  run npx --prefix "$WEB_DIR" astro check
else
  if (cd "$WEB_DIR" && npx astro check >/tmp/sc-astro-check.log 2>&1); then
    ok "type check passed"
  else
    note "type check reported problems (details: /tmp/sc-astro-check.log). The site may still run."
  fi
fi

cat <<EOF

${G}${B}All set.${N}

  Run the site:     cd "$WEB_DIR" && npm run dev
  Then open:        http://localhost:4321

  Open a new Terminal window first (or run: source ~/.zprofile ~/.zshrc)
  so the new tools are on your PATH.

  Publish changes:  cd "$REPO_DIR" && bash scripts/publish.sh
                    (checks the site builds, saves your changes, pushes them to GitHub main)

  Settings:         $WEB_DIR/.env
  Project status:   $REPO_DIR/docs/STATUS.md
EOF
