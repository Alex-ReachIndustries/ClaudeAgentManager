#!/bin/bash
# ClaudeManager Startup Script — Linux (Ubuntu 24.04)
# Run on login via systemd user service or ~/.config/autostart
# Ensures: Docker services, PM2 (launcher+watchdog), and Cam agent are running

set -e

echo "[$(date -u +%H:%M:%S)] ClaudeManager startup beginning..."

CM_DIR="$HOME/ClaudeManager"

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

# Ensure PM2 processes are running (launcher + watchdog)
echo "[$(date -u +%H:%M:%S)] Ensuring PM2 processes..."
pm2 resurrect 2>/dev/null || true

# Wait a moment for services to initialize
sleep 5

# Launch Cam — the system manager agent (only if not already running)
echo "[$(date -u +%H:%M:%S)] Launching Cam (system manager agent)..."
# Check if a tmux session named "Cam" already exists
if ! tmux has-session -t "Cam" 2>/dev/null; then
    tmux new-session -d -s "Cam" -n "Cam - System Manager" \
        "bash -c 'cd \"$CM_DIR\" && exec claude --dangerously-skip-permissions \"You are Cam, the ClaudeManager system manager agent. Run /session-init then begin your duties: monitor all running agents, keep system resources tidy, ensure project managers are alive and responsive, and post a status report to the session manager every 15 minutes covering: running agents, system load (CPU/disk), any issues detected. Your title should be Cam — System Manager.\"'"
    gnome-terminal --title "Cam - System Manager" -- tmux attach -t "Cam" &
fi

echo "[$(date -u +%H:%M:%S)] ClaudeManager startup complete."
