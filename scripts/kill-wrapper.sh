#!/usr/bin/env bash
# Installed as ~/.local/bin/kill (ahead of /usr/bin/kill on PATH) so `xargs kill`, `env kill`
# and other non-builtin calls get the same protection as the shell function. See kill-guard.sh.
GUARD="$(dirname "$(readlink -f "$0")")/kill-guard.sh"
if [ -r "$GUARD" ]; then
  # shellcheck source=kill-guard.sh
  . "$GUARD"
  __kill_guard_check "$@" || exit 1
fi
exec /usr/bin/kill "$@"
