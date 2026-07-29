#!/usr/bin/env bash
#
# ClaudeManager — turnkey installer for macOS
#
# Gets a FRESH Mac running the Claude Agent Manager end to end:
#   installs Homebrew (if missing) → Docker Desktop, Node.js, Claude Code, Git →
#   clones the repo → brings the stack up → shows the API key the backend
#   generates → walks the Claude login and (optionally) Tailscale remote access.
#
# LEAN on purpose (only what the Manager needs). IDEMPOTENT (safe to re-run).
#
# NOTE: this script is written to mirror install-linux.sh but has NOT been
# validated on a real Mac yet — no Mac was available. Treat as v1; the Docker
# Desktop step in particular needs a human to launch the app once.
#
# Usage:
#   bash install-mac.sh            # do it
#   bash install-mac.sh --dry-run  # print actions, change nothing
#
set -euo pipefail

REPO_URL="${CLAUDEMANAGER_REPO:-https://github.com/Alex-ReachIndustries/ClaudeAgentManager.git}"
INSTALL_DIR="${CLAUDEMANAGER_DIR:-$HOME/ClaudeAgentManager}"
NODE_MAJOR_MIN=20
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

c_step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
c_ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
c_warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }
c_ask()  { printf '\n\033[1;35m?\033[0m %s ' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then printf '    [dry-run] %s\n' "$*"; else eval "$@"; fi; }
trap 'c_err "step failed (line $LINENO). The installer is idempotent — fix the cause and re-run."' ERR

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
c_step "Preflight checks"
if [ "$(uname)" != "Darwin" ]; then c_err "This is the macOS installer. Use install-linux.sh on Linux."; exit 1; fi
if [ "$(id -u)" = 0 ]; then c_err "Run as your normal user, not root/sudo."; exit 1; fi
c_ok "macOS detected$( [ "$DRY_RUN" = 1 ] && echo '  (DRY RUN — no changes will be made)')"

# ---------------------------------------------------------------------------
# 1. Homebrew
# ---------------------------------------------------------------------------
c_step "Homebrew"
if command -v brew >/dev/null 2>&1; then
  c_ok "Homebrew already installed"
else
  run '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  # Ensure brew is on PATH for the rest of this script (Apple Silicon puts it in /opt/homebrew)
  if [ "$DRY_RUN" = 0 ]; then
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
  fi
  c_ok "Homebrew installed"
fi

# ---------------------------------------------------------------------------
# 2. Docker Desktop
# ---------------------------------------------------------------------------
c_step "Docker Desktop"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  c_ok "Docker + Compose already installed ($(docker --version 2>/dev/null))"
else
  run "brew install --cask docker"
  c_warn "Docker Desktop is installed but must be LAUNCHED once from Applications so the engine starts (and to accept its license). Open it, wait until it says 'running', then re-run this script — it'll continue from here."
  if [ "$DRY_RUN" = 0 ]; then
    open -a Docker 2>/dev/null || true
    # wait up to ~2 min for the docker engine to come up
    for i in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 3; done
    if ! docker info >/dev/null 2>&1; then
      c_err "Docker engine not up yet. Launch Docker Desktop, wait for 'running', then re-run this script."
      exit 1
    fi
  fi
  c_ok "Docker engine up"
fi

# ---------------------------------------------------------------------------
# 3. Node.js (>= 20), Git, Claude Code
# ---------------------------------------------------------------------------
c_step "Node.js ${NODE_MAJOR_MIN}+, Git"
node_ok=0
if command -v node >/dev/null 2>&1; then
  cur="$(node --version | sed 's/^v//' | cut -d. -f1)"; [ "${cur:-0}" -ge "$NODE_MAJOR_MIN" ] && node_ok=1
fi
[ "$node_ok" = 1 ] && c_ok "Node $(node --version) present" || run "brew install node"
command -v git >/dev/null 2>&1 && c_ok "Git present" || run "brew install git"

c_step "Claude Code CLI"
if command -v claude >/dev/null 2>&1; then
  c_ok "Claude Code already installed ($(claude --version 2>/dev/null || echo present))"
else
  run "npm install -g @anthropic-ai/claude-code"
  c_ok "Claude Code installed"
fi

# ---------------------------------------------------------------------------
# 4. Clone / update repo
# ---------------------------------------------------------------------------
c_step "ClaudeManager source → $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  c_ok "repo present — pulling latest"; run "git -C \"$INSTALL_DIR\" pull --ff-only"
else
  run "git clone \"$REPO_URL\" \"$INSTALL_DIR\""; c_ok "cloned"
fi

# ---------------------------------------------------------------------------
# 5. Bring the stack up
# ---------------------------------------------------------------------------
c_step "Starting the Manager (docker compose up -d --build)"
run "cd \"$INSTALL_DIR\" && docker compose up -d --build"
if [ "$DRY_RUN" = 0 ]; then
  c_step "Waiting for the backend to become healthy"
  ok=0
  for i in $(seq 1 40); do
    curl -fsS --max-time 3 http://localhost:3001/api/health 2>/dev/null | grep -q ok && { ok=1; break; }
    sleep 3
  done
  [ "$ok" = 1 ] && c_ok "backend healthy on :3001, dashboard on :8080" || { c_err "backend not healthy — check: cd $INSTALL_DIR && docker compose logs backend"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 6. API key
# ---------------------------------------------------------------------------
c_step "Your API key"
mkdir -p "$HOME/.claude"
API_KEY=""
if [ "$DRY_RUN" = 0 ]; then
  API_KEY="$(cd "$INSTALL_DIR" && docker compose logs backend 2>/dev/null | grep -Eio 'API Key[^:]*: [a-f0-9]{64}' | tail -1 | grep -Eo '[a-f0-9]{64}' || true)"
  if [ -n "$API_KEY" ]; then
    printf '%s\n' "$API_KEY" > "$HOME/.claude/agent-manager-key"; chmod 600 "$HOME/.claude/agent-manager-key"
    echo "http://localhost:3001" > "$HOME/.claude/agent-server-url"
    c_ok "saved to ~/.claude/agent-manager-key"
  else
    c_warn "couldn't auto-read the key. Get it with:  cd $INSTALL_DIR && docker compose logs backend | grep -i 'API Key'"
  fi
else
  c_ok "[dry-run] would read the generated key from backend logs and save it"
fi

# ---------------------------------------------------------------------------
# 7. Optional Tailscale
# ---------------------------------------------------------------------------
c_step "Remote access via Tailscale (optional)"
want_ts="n"
if [ "$DRY_RUN" = 0 ] && [ -t 0 ]; then c_ask "Set up Tailscale for phone access? [y/N]"; read -r want_ts || true; fi
# lowercase via tr (macOS default bash is 3.2 — no ${var,,})
if [ "$(printf '%s' "$want_ts" | tr '[:upper:]' '[:lower:]')" = "y" ]; then
  command -v tailscale >/dev/null 2>&1 || run "brew install --cask tailscale"
  c_warn "IMPORTANT: sign in with a PERSONAL email (not a work/org email) or your phone won't see this Mac."
  run "sudo tailscale up"
  run "sudo tailscale serve --bg 8080"
  c_ok "Tailscale serving the dashboard. Find your address with 'tailscale status'."
else
  c_ok "skipped"
fi

# ---------------------------------------------------------------------------
# 8. Final walkthrough
# ---------------------------------------------------------------------------
c_step "Almost done — final steps"
cat <<EOF

  ClaudeManager is running.

  Dashboard:   http://localhost:8080   (paste the API key below on first load)
$( [ -n "$API_KEY" ] && printf '  API key:     %s\n' "$API_KEY" )

  To LAUNCH agents from the dashboard:
    1. Log in to Claude Code (one time):   claude
    2. Start the host launcher:            cd "$INSTALL_DIR/launcher" && node launcher.js

  A machine that only VIEWS the dashboard (e.g. your phone) needs none of this —
  just the Tailscale address in a browser.

EOF
c_ok "install-mac.sh complete"
