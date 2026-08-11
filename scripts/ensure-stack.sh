#!/usr/bin/env bash
# Ensure the ClaudeManager service stack is up.
#
# WHY THIS EXISTS: the compose services already carry `restart: unless-stopped`, which covers
# crashes, daemon restarts and reboots — but NOT a deliberate stop. `docker compose stop` (or a
# stray `docker stop`) deliberately marks containers stopped, and Docker will then never bring
# them back. On 2026-08-10 the whole stack sat Exited(0) for ~14 hours that way while the host
# stayed up: dashboard, Knowledge Hub and agent messaging were all offline and nothing noticed.
# This check closes that gap by actively restoring the stack.
#
# MAINTENANCE ESCAPE HATCH: touch the sentinel file below to stop this from fighting you when
# you intentionally take the stack down. Remove it to re-arm.
#   touch /home/kuroneko2539/Research/ClaudeManager/.maintenance
set -uo pipefail

CM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SENTINEL="$CM_DIR/.maintenance"
HEALTH_URL="http://localhost:3001/api/health"
WEB_URL="http://localhost:8080/"

log() { echo "[$(date -u +%H:%M:%S)] ensure-stack: $*"; }

if [[ -f "$SENTINEL" ]]; then
  log "maintenance sentinel present ($SENTINEL) — standing down, not touching the stack."
  exit 0
fi

backend_ok() { curl -fsS --max-time 8 -o /dev/null "$HEALTH_URL" 2>/dev/null; }
web_ok()     { curl -fsS --max-time 8 -o /dev/null "$WEB_URL" 2>/dev/null; }

if backend_ok && web_ok; then
  exit 0
fi

# One retry before acting — avoids restarting during a transient blip (e.g. a redeploy in
# flight, or the backend still coming up).
sleep 10
if backend_ok && web_ok; then
  exit 0
fi

log "stack unhealthy (backend_ok=$(backend_ok && echo yes || echo no) web_ok=$(web_ok && echo yes || echo no)) — running docker compose up -d"
cd "$CM_DIR" || { log "cannot cd to $CM_DIR"; exit 1; }
if docker compose up -d 2>&1; then
  sleep 12
  if backend_ok && web_ok; then
    log "stack restored."
  else
    log "WARNING: compose up ran but the stack is still unhealthy — needs a human."
  fi
else
  log "ERROR: docker compose up -d failed."
fi
