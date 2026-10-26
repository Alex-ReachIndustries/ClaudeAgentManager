#!/usr/bin/env bash
# Tests for scripts/kill-guard.sh. Only __kill_guard_check is exercised for protected pids:
# nothing protected is ever actually signalled. A throwaway `sleep` is the one real target.
cd "$(dirname "$0")/.." || exit 1
. ./kill-guard.sh
pass=0; fail=0
expect() { # expect allow|deny <args...>
  local want=$1; shift
  if __kill_guard_check "$@" 2>/dev/null; then got=allow; else got=deny; fi
  if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: kill $* -> $got (want $want)"; fi
}
UM=$(pgrep -u "$(id -u)" -x systemd | head -1)
TMUX_SRV=$(pgrep -x 'tmux: server' | head -1)
sleep 300 & S=$!

# The 2026-10-26 incident: SIGTERM to the user's systemd manager.
expect deny $UM
expect deny -TERM $UM
expect deny -s TERM $UM
expect deny -9 -- -$UM
expect deny 1
expect deny -- -1
expect deny -9 -1
expect deny 0
[ -n "$TMUX_SRV" ] && expect deny $TMUX_SRV
expect deny $PPID
# Ordinary targets stay allowed.
expect allow $S
expect allow -9 $S
expect allow -s TERM $S
expect allow -l
expect allow %1
expect allow -1                              # "kill -1" = signal 1 with no pid: a usage error, harmless
# Override.
KILL_GUARD_OFF=1 expect allow $UM
# The wrapper refuses too and really kills an allowed target.
if ./kill-wrapper.sh $UM 2>/dev/null; then fail=$((fail+1)); echo "FAIL: wrapper allowed user manager"; else pass=$((pass+1)); fi
if ./kill-wrapper.sh $S; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: wrapper refused sleep"; fi
# The function refuses and the protected process is untouched.
kill $UM 2>/dev/null && { fail=$((fail+1)); echo "FAIL: function allowed user manager"; } || pass=$((pass+1))
[ "$(ps -o comm= -p $UM)" = systemd ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL: user manager gone"; }
echo "kill-guard: $pass passed, $fail failed"
[ $fail -eq 0 ]
