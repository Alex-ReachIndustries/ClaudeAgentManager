#!/usr/bin/env bash
# kill-guard: refuse to signal processes whose death takes the whole host session down.
#
# Why: on 2026-10-26 an agent ran `kill $(ps -o ppid= -p <pid>)` on an orphaned test process.
# Orphans in a user session are re-parented to `systemd --user`, so the computed "parent" was
# the user's systemd manager. SIGTERM to it starts exit.target, which tore down the desktop,
# every agent's tmux pane and the watchdog. The fleet was dead for 8 hours.
#
# Sourced from ~/.bashrc (so agent shell snapshots get the `kill` function) and used by
# ~/.local/bin/kill (so `xargs kill` and `env kill` are covered too).
# Override for a pid you have verified by hand: KILL_GUARD_OFF=1 kill ...

__kill_guard_protected() {
  # Print the pids that must never be signalled, one per line.
  echo 1
  pgrep -u "$(id -u)" -x systemd 2>/dev/null          # the user's systemd manager
  pgrep -x 'tmux: server' 2>/dev/null                 # tmux server: every agent pane lives in it
  pgrep -x claude 2>/dev/null                         # agent sessions (yours and other agents')
  pgrep -f 'node (.*/)?(launcher|watchdog)\.js' 2>/dev/null
  pgrep -x 'Xorg|Xwayland|cinnamon|cinnamon-session|cinnamon-session-binary|gnome-terminal-server|lightdm|sshd|dockerd|containerd|dbus-daemon|tailscaled|systemd-logind' 2>/dev/null
  # This shell's own ancestors (killing one kills the caller).
  local p=$$ pp
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    pp=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$pp" ] || break
    echo "$pp"
    p=$pp
  done
}

# Return 0 if the args are safe to pass to kill, 1 (with a message) if they target a protected pid.
__kill_guard_check() {
  [ "${KILL_GUARD_OFF:-}" = 1 ] && return 0
  local args=("$@") i=0 n=${#args[@]} a targets=()
  # Only the FIRST arg can be a signal spec (-9, -TERM, -s SIG, -n N); like bash, everything
  # after it is a target, so `kill -9 -1` targets -1. A leading '--' ends options.
  if [ $n -gt 0 ]; then
    a=${args[0]}
    case "$a" in
      --) i=1 ;;
      -l|-L|--list|--table) return 0 ;;
      -s|-n|--signal) i=2 ;;
      -[0-9]*|-[A-Za-z]*) i=1 ;;
    esac
    [ $i -gt 0 ] && [ $i -lt $n ] && [ "${args[$i]}" = -- ] && i=$((i+1))
  fi
  while [ $i -lt $n ]; do targets+=("${args[$i]}"); i=$((i+1)); done
  [ ${#targets[@]} -eq 0 ] && return 0
  local prot t abs
  prot=$(__kill_guard_protected | sort -u)
  for t in "${targets[@]}"; do
    [[ "$t" =~ ^-?[0-9]+$ ]] || continue          # job specs (%1) etc. pass through
    if [ "$t" = -1 ] || [ "$t" = 0 ]; then
      echo "kill-guard: refusing 'kill $t' (signals every process / the whole group)." >&2; return 1
    fi
    abs=${t#-}
    if printf '%s\n' "$prot" | grep -qx "$abs"; then
      echo "kill-guard: refusing to signal pid $abs: $(ps -o comm= -p "$abs" 2>/dev/null || echo '?') is protected (systemd, tmux, claude, launcher/watchdog, desktop, or this shell's ancestor). If you computed this pid from a ppid, the process you meant was probably orphaned. Check it with: ps -o pid,ppid,comm,args -p <pid>" >&2
      return 1
    fi
  done
  return 0
}

kill() {
  __kill_guard_check "$@" || return 1
  builtin kill "$@"
}
