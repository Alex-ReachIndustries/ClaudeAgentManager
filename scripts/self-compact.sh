#!/usr/bin/env bash
# Compact an agent's context from OUTSIDE its session.
#
# Why: an agent cannot run Claude Code's built-in /compact itself (only typed input runs it), and
# auto-compact only fires when a turn pushes context over the threshold. An agent near the limit
# that declines work to "save context" therefore never compacts: Sonnet B sat at 5-7% until
# auto-compact, answering "context exhausted", for ~24h (2026-10-16/17).
#
# What: wait until the agent's pane is idle, clear its input line, type "/compact <hints>", wait for
# the compaction to finish, then type a prompt telling it to re-ground via /session-connect.
#
# Used by:
#   - the /compact-context command (the agent schedules its own compaction, then ends its turn)
#   - scripts/watchdog.js (backstop for idle agents close to the auto-compact threshold)
#
# Usage: self-compact.sh <agent-uuid> [--reason self|watchdog]
# Detaches itself and returns at once; progress goes to /tmp/self-compact-<short id>.log.

set -u
ID="${1:-}"
REASON="self"
[ "${2:-}" = "--reason" ] && REASON="${3:-self}"
case "$ID" in
  ????????-????-????-????-????????????) ;;
  *) echo "usage: self-compact.sh <agent-uuid> [--reason self|watchdog]" >&2; exit 2 ;;
esac
SHORT="${ID:0:8}"
LOG="/tmp/self-compact-${SHORT}.log"

# Detach: the caller (an agent's Bash tool, or the watchdog) must not wait on us, and the agent's
# turn has to END before we can type into its pane.
if [ -z "${SELF_COMPACT_CHILD:-}" ]; then
  SELF_COMPACT_CHILD=1 setsid nohup bash "$0" "$@" >>"$LOG" 2>&1 </dev/null &
  echo "self-compact scheduled for ${SHORT} (reason=${REASON}); it runs once your turn ends. Log: ${LOG}"
  exit 0
fi

log() { echo "[$(date '+%F %T')] $*"; }

# One helper per agent at a time.
exec 9>"/tmp/self-compact-${SHORT}.lock"
if ! flock -n 9; then log "another self-compact is already running for ${SHORT}; exiting"; exit 0; fi

# Resolve the agent's own window across all sessions (never display-message: that reads whichever
# window the client has focused, which may be another agent's).
TARGET=$(tmux list-windows -a -F '#{session_name}:#{window_name}' 2>/dev/null | grep -m1 ":${SHORT}\$")
[ -n "$TARGET" ] || { log "no tmux window named ${SHORT}; exiting"; exit 1; }

tail_lines() { tmux capture-pane -p -t "$TARGET" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n "${1:-12}"; }
# Same test as watchdog.js paneTurnInProgress: a live status line like "Perusing… (4s · …)".
busy() { tail_lines 12 | grep -qE '…[[:space:]]*\([0-9]+[ms]'; }
# Never type into a blocking prompt or menu: those are decisions for a person.
blocked() {
  local t; t=$(tail_lines 14)
  grep -q 'Do you want to proceed?' <<<"$t" && return 0
  grep -q 'Enter to confirm' <<<"$t" && return 0
  return 1
}
# Idle = not busy and not blocked on two checks a few seconds apart (a Monitor event can start a
# new turn at any moment).
wait_idle() {
  local deadline=$(( $(date +%s) + $1 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if ! busy && ! blocked; then
      sleep 4
      if ! busy && ! blocked; then return 0; fi
    fi
    sleep 3
  done
  return 1
}
type_line() {
  tmux send-keys -t "$TARGET" C-u; sleep 0.3
  tmux send-keys -t "$TARGET" C-u; sleep 0.3   # input may hold injected text over several lines
  tmux send-keys -t "$TARGET" -l "$1"; sleep 0.5
  tmux send-keys -t "$TARGET" Enter
}

log "start: target=${TARGET} reason=${REASON}"
sleep 5   # let the requesting turn finish
if ! wait_idle 1200; then log "agent never went idle within 20 min; giving up"; exit 1; fi

type_line "/compact Preserve: your role/title, PM and project ids, the exact task in progress (repo, branch, modified files, what is done vs remaining), blockers, unacked message ids, any AWAITING_GREENLIGHT plan, and the state of your message watcher."
log "typed /compact"

# Wait for the compaction to start, then to finish. Finished = the "Compacting conversation"
# status line has come and gone. Do not also require idle: a Monitor event queued during the
# compaction starts a new turn the moment it ends (Sonnet C, 2026-10-17), and that is fine.
seen=0
start=$(date +%s)
deadline=$(( start + 900 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 3
  t=$(tail_lines 12)
  if grep -qiE 'error (during|compacting)|compaction failed|conversation too long' <<<"$t"; then
    log "compaction reported an error:"; echo "$t"; exit 1
  fi
  if grep -q 'Compacting conversation' <<<"$t"; then seen=1; continue; fi
  [ "$seen" = 1 ] && break
  # Never saw it (very fast, or not a Claude pane): accept once a minute has passed and it is idle.
  if [ $(( $(date +%s) - start )) -ge 60 ] && ! busy; then break; fi
done
[ "$(date +%s)" -lt "$deadline" ] || { log "compaction did not finish within 15 min"; exit 1; }
log "compaction finished (status line seen: ${seen})"

# Prefer an idle pane; if the agent went straight into a queued turn, type anyway: Claude Code
# queues the line and delivers it when that turn ends.
wait_idle 300 || log "agent busy after compaction; the re-ground prompt will be queued"
if [ "$REASON" = "watchdog" ]; then
  why="The watchdog compacted your context because you were close to the auto-compact limit."
else
  why="Your /compact-context request has completed."
fi
type_line "${why} Run /session-connect compact now (re-read claudeadmin/context-summary.md, make sure exactly ONE message watcher is running (compaction does NOT stop your Monitor: if one is still running keep it and do not start another; start one only if none is running), check for pending messages), then carry on with your task. Never decline work as 'context exhausted': run /compact-context instead."
log "typed re-ground prompt; done"
