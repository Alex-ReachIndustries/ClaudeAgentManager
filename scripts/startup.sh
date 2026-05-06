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

# Start screen interaction service (Linux with X11 only)
if [[ "$(uname)" == "Linux" ]] && [[ -n "${DISPLAY:-}" ]]; then
    echo "[$(date -u +%H:%M:%S)] Starting screen-service..."
    bash "$CM_DIR/screen-service/start.sh" || true
fi

# Wait a moment for services to initialize
sleep 5

# Launch Cam — the system manager agent (only if not already running)
echo "[$(date -u +%H:%M:%S)] Launching Cam (system manager agent)..."
# Write cam model config so session-connect can include it in registration (used by launchResumeAgent to pick the right model on resume)
echo -n "claude-sonnet-4-6" > ~/.claude/cam-model
echo -n "high" > ~/.claude/cam-effort
# Check if a tmux session named "Dailies" already exists
if ! tmux has-session -t "Dailies" 2>/dev/null; then
    tmux new-session -d -s "Dailies" -n "Cam - System Manager" \
        "bash -c 'cd \"$CM_DIR\" && exec claude --model claude-sonnet-4-6 --effort high --dangerously-skip-permissions \"You are Cam, the ClaudeManager system manager agent. Run /session-connect then: (1) post-reboot triage — assess every agent record per feedback_reboot_recovery.md, archive obvious orphans, surface real-work resumes; (2) once triage is done, start the launcher daemon (it processes live launch_requests automatically — see step in startup.sh and feedback_cam_is_spawn_gatekeeper.md); (3) re-establish the monitoring schedule per ~/.claude/memory/feedback_monitoring_schedule.md (five recurring crons: 15-min message audit + three monitoring ticks + one daily maintenance cron — list with CronList first, only create those that are not already scheduled); (4) keep system resources tidy and ensure project managers are alive. Title: Cam — System Manager.\"'"
    # Open a desktop terminal window attached to the Dailies session if a GUI is available.
    # Tries Cinnamon's terminal first (Mint), then GNOME's, then xterm as a fallback.
    if [ -n "${DISPLAY:-}" ]; then
      if command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title "Dailies" -- tmux attach -t "Dailies" &
      elif command -v x-terminal-emulator &>/dev/null; then
        x-terminal-emulator -T "Dailies" -e tmux attach -t "Dailies" &
      elif command -v xterm &>/dev/null; then
        xterm -title "Dailies" -e tmux attach -t "Dailies" &
      fi
    fi
fi

# Start the launcher daemon AFTER Cam comes up — Cam needs a chance to triage
# stale agent records first per feedback_reboot_recovery.md, then the launcher
# can take over for live spawn requests. We sleep briefly to give Cam a window
# to register and start triaging before the launcher starts processing the
# queue (terminate-of-dead-PID requests for orphaned agents).
echo "[$(date -u +%H:%M:%S)] Waiting briefly for Cam to start triaging before launcher activates..."
sleep 15

if ! pgrep -af "node.*launcher\.js" > /dev/null; then
    echo "[$(date -u +%H:%M:%S)] Starting launcher daemon..."
    cd "$CM_DIR/launcher"
    nohup node launcher.js > /tmp/launcher.log 2>&1 &
    disown
    echo "[$(date -u +%H:%M:%S)] Launcher started (logs: /tmp/launcher.log)."
else
    echo "[$(date -u +%H:%M:%S)] Launcher already running — skipping."
fi

echo "[$(date -u +%H:%M:%S)] ClaudeManager startup complete."
