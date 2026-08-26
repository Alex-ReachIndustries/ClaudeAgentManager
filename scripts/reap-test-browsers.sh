#!/usr/bin/env bash
# Reap leaked agent CDP test browsers (/tmp/chrome-debug*).
#
# WHY THIS EXISTS: agents launch headless Chrome with --remote-debugging-port for browser
# testing (per CLAUDE.md) and frequently never close it. On 2026-08-26 a single leaked
# profile (chrome-debug-layout) held 137 processes and 16.5GB for 36 hours on a 31GB host —
# RAM exhausted, swap 100% full, and the whole desktop froze periodically: cursor moving,
# every window dead, session manager unreachable. Killing that one profile returned 11GB.
#
# SAFETY: only reaps a browser that is BOTH older than MAX_AGE_MIN and has ZERO established
# connections on its debug port. A real test session lasts minutes and holds a live CDP
# connection, so an in-use browser is never touched.
#
# Records a row EVERY run, including no-ops — "ran and found nothing" must be
# distinguishable from "never ran" (see KB 343).
set -uo pipefail
MAX_AGE_MIN=${MAX_AGE_MIN:-120}
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] reap-test-browsers: $*"; }

reaped=0; skipped_active=0; skipped_young=0; dirs_removed=0

# Top-level browsers only (no --type=), one per profile.
# Only real chrome processes (comm=chrome). Matching on args alone self-matches this very
# script and any shell mentioning the path — that footgun killed the invoking shell once.
mapfile -t TOPS < <(ps -eo pid,comm,args --no-headers 2>/dev/null \
  | awk '$2 ~ /^chrome/' | grep -F -- '--user-data-dir=/tmp/chrome-debug' \
  | grep -v -- '--type=' | awk '{print $1}')

for pid in "${TOPS[@]:-}"; do
  [ -z "${pid:-}" ] && continue
  kill -0 "$pid" 2>/dev/null || continue
  prof=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -oE -- '--user-data-dir=[^ ]*' | head -1 | cut -d= -f2)
  age_min=$(( ( $(date +%s) - $(stat -c %Y "/proc/$pid" 2>/dev/null || date +%s) ) / 60 ))
  if [ "$age_min" -lt "$MAX_AGE_MIN" ]; then
    skipped_young=$((skipped_young+1)); continue
  fi
  # Any live CDP client attached to this browser?
  conns=$(ss -tnp 2>/dev/null | grep -c "pid=$pid," || true)
  if [ "${conns:-0}" -gt 0 ]; then
    log "SKIP $prof (pid $pid): ${age_min}m old but $conns live CDP connection(s)"
    skipped_active=$((skipped_active+1)); continue
  fi
  # Collect the whole tree by explicit PID. Never pkill -f a pattern that could match this
  # script's own command line — that self-match killed the invoking shell on 2026-08-26.
  mapfile -t TREE < <(ps -eo pid,comm,args --no-headers 2>/dev/null \
    | awk '$2 ~ /^chrome/' | grep -F -- "--user-data-dir=$prof" | awk '{print $1}')
  n=${#TREE[@]}
  log "REAP $prof (pid $pid, ${age_min}m old, no CDP clients): killing $n process(es)"
  kill -TERM "${TREE[@]}" 2>/dev/null || true
  sleep 5
  mapfile -t LEFT < <(ps -eo pid,comm,args --no-headers 2>/dev/null \
    | awk '$2 ~ /^chrome/' | grep -F -- "--user-data-dir=$prof" | awk '{print $1}')
  [ ${#LEFT[@]} -gt 0 ] && kill -9 "${LEFT[@]}" 2>/dev/null || true
  reaped=$((reaped+1))
done

# Remove profile dirs with no live process (pure disk cost, ~160MB each).
#
# TWO GUARDS, both learned the hard way on 2026-08-26:
#  1. Recency: skip any dir touched in the last DIR_IDLE_MIN minutes. Without this there is a
#     TOCTOU race — a browser launched between the process scan above and this sweep gets its
#     profile deleted out from under it. That happened on the FIRST run, to /tmp/chrome-debug,
#     which is precisely the default profile our instructions tell agents to reuse.
#  2. Re-check liveness immediately before each delete, narrowing the same race.
DIR_IDLE_MIN=${DIR_IDLE_MIN:-30}
for d in /tmp/chrome-debug*; do
  [ -d "$d" ] || continue
  if [ -n "$(find "$d" -maxdepth 0 -mmin -"$DIR_IDLE_MIN" 2>/dev/null)" ]; then
    log "SKIP dir $d (modified within ${DIR_IDLE_MIN}m — may belong to a starting browser)"
    continue
  fi
  if ps -eo comm,args --no-headers 2>/dev/null | awk '$1 ~ /^chrome/' | grep -qF -- "--user-data-dir=$d"; then
    continue
  fi
  rm -rf "$d" 2>/dev/null && dirs_removed=$((dirs_removed+1))
done

log "done: reaped=$reaped skipped_active=$skipped_active skipped_young=$skipped_young stale_dirs_removed=$dirs_removed mem_available=$(free -m | awk 'NR==2{print $7}')MB"
