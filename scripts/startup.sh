#!/bin/bash
# ClaudeManager Startup Script — Linux (Ubuntu 24.04)
# Run on login via systemd user service or ~/.config/autostart
# Ensures: Docker services, PM2 (launcher+watchdog), and Cam agent are running

set -e

echo "[$(date -u +%H:%M:%S)] ClaudeManager startup beginning..."

# Match the path used by 07-claude-manager.sh
CM_DIR="$HOME/Research/ClaudeManager"

# Wait for Docker daemon to be ready
echo "[$(date -u +%H:%M:%S)] Waiting for Docker..."
until docker info >/dev/null 2>&1; do
    sleep 5
done
echo "[$(date -u +%H:%M:%S)] Docker is ready."

# Start the Docker Compose stack (idempotent — skips already running)
echo "[$(date -u +%H:%M:%S)] Starting Docker services..."
cd "$CM_DIR"
docker compose up -d

# Wait for backend to be healthy
echo "[$(date -u +%H:%M:%S)] Waiting for backend health..."
until curl -s http://localhost:3001/api/health >/dev/null 2>&1; do
    sleep 5
done
echo "[$(date -u +%H:%M:%S)] Backend healthy."

# PM2 is no longer used — launcher runs in launcher/ via systemd or npm.
# Resurrect any old PM2 processes if PM2 happens to be installed.
if command -v pm2 &>/dev/null; then
  pm2 resurrect 2>/dev/null || true
fi

# Wait a moment for services to initialize
sleep 5

# Launch Cam — the system manager agent (only if not already running)
echo "[$(date -u +%H:%M:%S)] Launching Cam (system manager agent)..."
# Check if a tmux session named "Cam" already exists
if ! tmux has-session -t "Cam" 2>/dev/null; then
    tmux new-session -d -s "Cam" -n "Cam - System Manager" \
        "bash -c 'cd \"$CM_DIR\" && exec claude --dangerously-skip-permissions \"You are Cam, the ClaudeManager system manager agent. Run /session-connect then begin your duties: monitor all running agents, keep system resources tidy, ensure project managers are alive and responsive, and post a status report to the session manager every 15 minutes covering: running agents, system load (CPU/disk), any issues detected. Your title should be Cam — System Manager.\"'"
    # Open a desktop terminal window attached to the Cam session if a GUI is available.
    # Tries Cinnamon's terminal first (Mint), then GNOME's, then xterm as a fallback.
    if [ -n "${DISPLAY:-}" ]; then
      if command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title "Cam - System Manager" -- tmux attach -t "Cam" &
      elif command -v x-terminal-emulator &>/dev/null; then
        x-terminal-emulator -T "Cam - System Manager" -e tmux attach -t "Cam" &
      elif command -v xterm &>/dev/null; then
        xterm -title "Cam - System Manager" -e tmux attach -t "Cam" &
      fi
    fi
fi

echo "[$(date -u +%H:%M:%S)] ClaudeManager startup complete."
