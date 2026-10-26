#!/usr/bin/env bash
# PreToolUse hook (Bash): deny kill commands that can take the whole host session down.
# On 2026-10-26 one agent killed every `make` on the host (`pgrep -x make` loop), orphaning
# another agent's test process; that agent then ran `kill $(ps -o ppid= -p <pid>)`. Orphans
# are re-parented to `systemd --user`, so it SIGTERMed the user's systemd manager, which tore
# down the desktop, every agent's tmux pane and the watchdog: the fleet was dead for 8 hours.
# The runtime guard (scripts/kill-guard.sh, the `kill` function and ~/.local/bin/kill) catches
# computed pids; this hook stops the patterns before they run.
# Override after verifying the target by hand: add the comment  # kill-guard-ok
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *kill*|*systemctl*|*loginctl*) ;; *) exit 0 ;; esac
case "$cmd" in *'# kill-guard-ok'*) exit 0 ;; esac
# Heredoc bodies are file contents (docs, scripts being written), not commands: check line 1 only.
case "$cmd" in *'<<'*) cmd=${cmd%%$'\n'*} ;; esac

GENERIC='make|python|python3|node|npm|npx|docker|bash|sh|claude|tmux|systemd|java|gradle|chrome|google-chrome|sleep|godot'
# kill in COMMAND position only (line start, or after ; & | ( $( do then else), so prose such as
# echo "the ppid kill" in a log line is not matched.
CMDPOS='(^|[;&|(`]|\$\(|(^|[[:space:]])(do|then|else))[[:space:]]*(sudo[[:space:]]+)?'
KILLW="${CMDPOS}(kill|xargs([[:space:]]+-[^[:space:]]+)*[[:space:]]+kill)([[:space:]]|$)"
reason=""
if printf '%s' "$cmd" | grep -qiE 'ppid' && printf '%s' "$cmd" | grep -qE "$KILLW"; then
  reason="it kills a pid computed from a PARENT pid (ppid). If the child was orphaned, its parent is now systemd --user, and killing that logs out the whole session (every agent, the watchdog and the desktop). That is exactly what took the fleet down on 2026-10-26. Kill the process you started instead: keep its pid when you start it (cmd & echo \$!), or docker kill <your container>. Check any computed pid first with: ps -o pid,ppid,comm,args -p <pid>"
elif printf '%s' "$cmd" | grep -qE "${CMDPOS}(pkill|killall)([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-f[[:space:]]+)?[\"']?($GENERIC)([[:space:]\"']|$)"; then
  reason="pkill/killall by a generic name kills EVERY matching process on the host, including other agents' work. Scope it to your own process: kill the pid you saved when starting it, filter by your worktree (readlink /proc/<pid>/cwd), or docker kill your own container."
elif printf '%s' "$cmd" | grep -qE "pgrep[[:space:]]+(-[^[:space:]]+[[:space:]]+)*-x[[:space:]]+[\"']?($GENERIC)([[:space:]\"']|$)" && printf '%s' "$cmd" | grep -qE "$KILLW"; then
  reason="pgrep -x <generic name> feeding kill matches EVERY such process on the host, including other agents' (on 2026-10-26 this killed another agent's test run and set off the session crash). Filter by your own worktree cwd or exact command line, or kill the pid you saved when you started it."
elif printf '%s' "$cmd" | grep -qE "${CMDPOS}kill([[:space:]]+-[^[:space:]]+)?[[:space:]]+(--[[:space:]]+)?-1[[:space:]]*($|[;&|])"; then
  reason="kill -1 as a target signals every process you own: it would log out the whole session."
elif printf '%s' "$cmd" | grep -qE "${CMDPOS}kill([[:space:]]+-[^[:space:]]+)?[[:space:]]+(--[[:space:]]+)?1[[:space:]]*($|[;&|])"; then
  reason="that targets pid 1 (init)."
elif printf '%s' "$cmd" | grep -qE "systemctl[[:space:]]+--user[[:space:]]+(exit|kill|isolate|stop[[:space:]]+(default|graphical-session|basic)\.target)|loginctl[[:space:]]+(terminate|kill)-(user|session)"; then
  reason="that stops the user's systemd manager or login session, which kills every agent, the watchdog and the desktop."
fi
[ -z "$reason" ] && exit 0
jq -n --arg r "Blocked by the kill guard: $reason If you have verified the target by hand and it is safe, add the comment  # kill-guard-ok  to the command." '{
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r }
}'
exit 0
