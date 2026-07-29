#!/usr/bin/env bash
#
# ClaudeManager — turnkey installer for Linux (Debian / Ubuntu family)
#
# Gets a FRESH machine running the Claude Agent Manager end to end:
#   installs Docker, Node.js, Claude Code and Git → clones the repo →
#   brings the stack up → shows you the API key the backend generates →
#   walks you through the Claude login and (optionally) Tailscale remote access.
#
# It is LEAN on purpose — it installs only what the Manager needs, nothing else.
# It is IDEMPOTENT — safe to re-run; anything already installed is skipped.
#
# Usage:
#   bash install-linux.sh                # do it
#   bash install-linux.sh --dry-run      # print every action, change nothing
#   CLAUDEMANAGER_DIR=~/foo bash install-linux.sh   # custom install dir
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO_URL="${CLAUDEMANAGER_REPO:-https://github.com/Alex-ReachIndustries/ClaudeAgentManager.git}"
INSTALL_DIR="${CLAUDEMANAGER_DIR:-$HOME/ClaudeAgentManager}"
NODE_MAJOR_MIN=20
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# ---------------------------------------------------------------------------
# Pretty logging
# ---------------------------------------------------------------------------
c_step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
c_ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
c_warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }
c_ask()  { printf '\n\033[1;35m?\033[0m %s ' "$*"; }

# run — execute a command, or just print it in --dry-run mode
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '    [dry-run] %s\n' "$*"; else eval "$@"; fi
}

trap 'c_err "step failed (line $LINENO). Nothing destructive is left half-done; fix the cause and re-run — the installer is idempotent."' ERR

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
c_step "Preflight checks"
if [ "$(id -u)" = 0 ]; then
  c_err "Run as your normal user, NOT root/sudo. The script calls sudo itself where needed."
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  c_err "This installer targets Debian/Ubuntu (apt). For other distros install Docker, Node ${NODE_MAJOR_MIN}+, Claude Code and Git manually, then run 'docker compose up -d' in the repo."
  exit 1
fi
if ! sudo -v; then c_err "sudo access is required."; exit 1; fi
c_ok "Debian/Ubuntu detected, sudo available$( [ "$DRY_RUN" = 1 ] && echo '  (DRY RUN — no changes will be made)')"

# ---------------------------------------------------------------------------
# 1. Base packages
# ---------------------------------------------------------------------------
c_step "Base packages (curl, git, ca-certificates, gnupg)"
run "sudo apt-get update -y -q"
run "sudo apt-get install -y -q curl git ca-certificates gnupg"
c_ok "base packages present"

# ---------------------------------------------------------------------------
# 2. Docker Engine + Compose plugin
# ---------------------------------------------------------------------------
c_step "Docker Engine + Compose plugin"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  c_ok "Docker + Compose already installed ($(docker --version 2>/dev/null))"
else
  c_warn "installing Docker via get.docker.com convenience script"
  run "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh"
  run "sudo sh /tmp/get-docker.sh"
  run "sudo usermod -aG docker \"$USER\""
  c_ok "Docker installed"
  c_warn "You were added to the 'docker' group — you may need to log out/in (or run 'newgrp docker') for non-sudo docker to work. This script uses sudo for docker where needed so it works right now."
fi
# make sure the daemon is up
if [ "$DRY_RUN" = 0 ]; then
  if ! sudo docker info >/dev/null 2>&1; then
    run "sudo systemctl enable --now docker"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Node.js (>= 20)
# ---------------------------------------------------------------------------
c_step "Node.js ${NODE_MAJOR_MIN}+ (for the host launcher + Claude Code)"
node_ok=0
if command -v node >/dev/null 2>&1; then
  cur="$(node --version | sed 's/^v//' | cut -d. -f1)"
  [ "${cur:-0}" -ge "$NODE_MAJOR_MIN" ] && node_ok=1
fi
if [ "$node_ok" = 1 ]; then
  c_ok "Node $(node --version) already present"
else
  run "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x | sudo -E bash -"
  run "sudo apt-get install -y -q nodejs"
  c_ok "Node.js installed"
fi

# ---------------------------------------------------------------------------
# 4. Claude Code CLI
# ---------------------------------------------------------------------------
c_step "Claude Code CLI"
if command -v claude >/dev/null 2>&1; then
  c_ok "Claude Code already installed ($(claude --version 2>/dev/null || echo present))"
else
  run "sudo npm install -g @anthropic-ai/claude-code"
  c_ok "Claude Code installed"
fi

# ---------------------------------------------------------------------------
# 5. Clone (or update) the repo
# ---------------------------------------------------------------------------
c_step "ClaudeManager source → $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  c_ok "repo already present — pulling latest"
  run "git -C \"$INSTALL_DIR\" pull --ff-only"
else
  run "git clone \"$REPO_URL\" \"$INSTALL_DIR\""
  c_ok "cloned"
fi

# ---------------------------------------------------------------------------
# 6. Bring the stack up
# ---------------------------------------------------------------------------
c_step "Starting the Manager (docker compose up -d --build)"
run "cd \"$INSTALL_DIR\" && sudo docker compose up -d --build"

if [ "$DRY_RUN" = 0 ]; then
  c_step "Waiting for the backend to become healthy"
  ok=0
  for i in $(seq 1 40); do
    if curl -fsS --max-time 3 http://localhost:3001/api/health 2>/dev/null | grep -q ok; then ok=1; break; fi
    sleep 3
  done
  [ "$ok" = 1 ] && c_ok "backend healthy on :3001, dashboard on :8080" || { c_err "backend did not become healthy — check: cd $INSTALL_DIR && sudo docker compose logs backend"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 7. Retrieve the generated API key + seed ~/.claude
# ---------------------------------------------------------------------------
c_step "Your API key"
mkdir -p "$HOME/.claude"
API_KEY=""
if [ "$DRY_RUN" = 0 ]; then
  # The backend prints "API Key: <hex>" (or "API Key generated: <hex>") on startup.
  API_KEY="$(cd "$INSTALL_DIR" && sudo docker compose logs backend 2>/dev/null | grep -Eio 'API Key[^:]*: [a-f0-9]{64}' | tail -1 | grep -Eo '[a-f0-9]{64}' || true)"
  if [ -n "$API_KEY" ]; then
    printf '%s\n' "$API_KEY" > "$HOME/.claude/agent-manager-key"
    chmod 600 "$HOME/.claude/agent-manager-key"
    echo "http://localhost:3001" > "$HOME/.claude/agent-server-url"
    c_ok "saved to ~/.claude/agent-manager-key"
  else
    c_warn "couldn't auto-read the key from logs. Get it with:  cd $INSTALL_DIR && sudo docker compose logs backend | grep -i 'API Key'"
  fi
else
  c_ok "[dry-run] would read the generated key from 'docker compose logs backend' and save it to ~/.claude/agent-manager-key"
fi

# ---------------------------------------------------------------------------
# 8. Optional: Tailscale for remote access (phone / other machines)
# ---------------------------------------------------------------------------
c_step "Remote access via Tailscale (optional)"
want_ts="n"
if [ "$DRY_RUN" = 0 ] && [ -t 0 ]; then
  c_ask "Set up Tailscale so you can reach the dashboard from your phone? [y/N]"
  read -r want_ts || true
fi
if [ "${want_ts,,}" = "y" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    run "curl -fsSL https://tailscale.com/install.sh | sh"
  fi
  c_warn "IMPORTANT: sign in with a PERSONAL email (personal Google/GitHub/email) — NOT a work/org email. A work login puts this box on a different, org-managed tailnet and your phone won't see it."
  run "sudo tailscale up"
  run "sudo tailscale serve --bg 8080"
  c_ok "Tailscale serving the dashboard over HTTPS. Find your address with 'tailscale status'."
else
  c_ok "skipped (you can run this later)"
fi

# ---------------------------------------------------------------------------
# 9. Final walkthrough
# ---------------------------------------------------------------------------
c_step "Almost done — final steps"
cat <<EOF

  ClaudeManager is running.

  Dashboard:   http://localhost:8080   (paste the API key below on first load)
$( [ -n "$API_KEY" ] && printf '  API key:     %s\n' "$API_KEY" )

  To actually LAUNCH agents from the dashboard you need two more things:

    1. Log in to Claude Code (one time, opens a browser):
         claude
       Complete the OAuth login, then you can close it.

    2. Start the host launcher (spawns agent sessions):
         cd "$INSTALL_DIR/launcher" && node launcher.js
       (leave it running; or set it up as a service later)

  A machine that only VIEWS the dashboard (e.g. your phone) needs none of the
  above — just the Tailscale address in a browser.

EOF
c_ok "install-linux.sh complete"
