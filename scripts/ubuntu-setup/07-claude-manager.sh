#!/bin/bash
set -euo pipefail
echo "=== 07: ClaudeManager Setup ==="

REPO_DIR="$HOME/Research/ClaudeManager"
# The master key for this desktop's agent manager. Do NOT hardcode secrets in the
# repo — supply it via the AGENT_MANAGER_KEY env var before running (the same value
# step 00 wrote to ~/.claude/agent-manager-key). Fresh installs can leave it unset
# and let the backend generate one (see setup/install-linux.sh).
AGENT_MANAGER_KEY="${AGENT_MANAGER_KEY:-}"
if [ -z "$AGENT_MANAGER_KEY" ]; then
  echo "AGENT_MANAGER_KEY not set — export it first, e.g. 'export AGENT_MANAGER_KEY=<key>', then re-run." >&2
  exit 1
fi

# Clone or update repo
if [ -d "$REPO_DIR/.git" ]; then
  echo "Repo exists, pulling latest..."
  git -C "$REPO_DIR" pull
else
  echo "Cloning repo..."
  mkdir -p "$HOME/Research"
  git clone https://github.com/Alex-ReachIndustries/ClaudeAgentManager.git "$REPO_DIR"
fi

cd "$REPO_DIR"

# Copy .env if not present
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

# Pin API_KEY in .env so it survives container rebuilds and matches
# the key Claude already has in ~/.claude/agent-manager-key.
if [ -f .env ]; then
  if grep -qE '^[# ]*API_KEY=' .env; then
    # Replace existing line (commented or not)
    sed -i "s|^[# ]*API_KEY=.*|API_KEY=$AGENT_MANAGER_KEY|" .env
  else
    echo "API_KEY=$AGENT_MANAGER_KEY" >> .env
  fi
fi

# Create agent data directory
sudo mkdir -p /ClaudeManager/agent-data
sudo chown -R "$USER:$USER" /ClaudeManager

# Install launcher dependencies
cd "$REPO_DIR/launcher"
npm install

# Set launcher mode for Linux
if [ -f .env ]; then
  if grep -qE '^[# ]*LAUNCHER_MODE=' .env; then
    sed -i "s|^[# ]*LAUNCHER_MODE=.*|LAUNCHER_MODE=linux|" .env
  else
    echo "LAUNCHER_MODE=linux" >> .env
  fi
else
  echo "LAUNCHER_MODE=linux" > .env
fi

# Install scripts/ deps if any
cd "$REPO_DIR/scripts"
[ -f package.json ] && npm install || true

cd "$REPO_DIR"

# Build and start services
echo "Starting Docker services..."
if docker ps >/dev/null 2>&1; then
  DOCKER_CMD="docker"
else
  echo "Note: using sudo docker (log out/in to use docker without sudo permanently)"
  DOCKER_CMD="sudo docker"
fi
$DOCKER_CMD compose pull --ignore-pull-failures 2>/dev/null || true
$DOCKER_CMD compose up -d

# Wait for backend health and verify the API key works
echo "Waiting for backend to come up..."
for i in $(seq 1 30); do
  if curl -fsSL --max-time 2 "http://localhost:3001/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if curl -fsSL --max-time 5 \
    -H "Authorization: Bearer $AGENT_MANAGER_KEY" \
    "http://localhost:3001/api/agents" >/dev/null 2>&1; then
  echo "✓ API key validated — Claude can now talk to the agent manager"
else
  echo "WARNING: API key check failed — verify backend logs and .env"
fi

echo ""
echo "✓ ClaudeManager services started"
echo ""
echo "NEXT STEPS:"
echo "  1. Check dashboard: http://localhost:3001 or via Tailscale hostname"
echo "  2. (Optional) Edit $REPO_DIR/.env for hostname-specific config"
echo "  3. Run step 08-systemd-autostart.sh to make it boot automatically"
