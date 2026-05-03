#!/bin/bash
set -euo pipefail
echo "=== 08: ClaudeManager Setup ==="

REPO_DIR="$HOME/Research/ClaudeManager"

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
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit it before starting services"
  fi
fi

# Create agent data directory
sudo mkdir -p /ClaudeManager/agent-data
sudo chown -R "$USER:$USER" /ClaudeManager

# Install launcher dependencies
cd "$REPO_DIR/launcher"
npm install

# Install watchdog/scripts dependencies (if any)
cd "$REPO_DIR/scripts"
[ -f package.json ] && npm install || true

cd "$REPO_DIR"

# Build and start services via docker compose
echo "Starting Docker services..."
docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose up -d

echo ""
echo "✓ ClaudeManager services started"
echo ""
echo "NEXT STEPS (manual):"
echo "1. Edit $REPO_DIR/.env with your API keys and config"
echo "2. Set LAUNCHER_MODE=linux in launcher/.env or as env var"
echo "3. Run '08b-credentials.sh' to set up auth keys"
echo "4. Run the startup script: $REPO_DIR/scripts/startup.sh"
