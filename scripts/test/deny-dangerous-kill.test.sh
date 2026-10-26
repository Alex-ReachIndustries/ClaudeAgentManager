#!/usr/bin/env bash
# Tests for ~/.claude/hooks/deny-dangerous-kill.sh: feeds commands as PreToolUse JSON, checks
# deny/allow. Nothing is executed.
HOOK=${HOOK:-$HOME/.claude/hooks/deny-dangerous-kill.sh}
pass=0; fail=0
expect() { # expect deny|allow '<command>'
  local got
  got=$(jq -n --arg c "$2" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$HOOK" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
  [ -z "$got" ] && got=allow
  if [ "$got" = "$1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL ($got, want $1): $2"; fi
}
# The two 2026-10-26 incident commands, verbatim.
expect deny  'PP=$(ps -o ppid= -p 1957868 | tr -d '"' '"'); ps -o pid,args -p $PP | cut -c1-100; kill $PP; docker kill ff3d6bc6992c >/dev/null'
expect deny  'pgrep -x make | head -3; for p in $(pgrep -x make); do kill $p 2>/dev/null; done; sleep 1'
expect deny  'pkill -f "make test" 2>/dev/null; docker ps'
# Other dangerous shapes.
expect deny  'kill $(ps -o ppid= -p $X)'
expect deny  'kill -9 $PPID'
expect deny  'ps -o ppid= -p 123 | xargs kill'
expect deny  'pkill python3'
expect deny  'killall node'
expect deny  'pkill -9 -f claude'
expect deny  'kill -9 -1'
expect deny  'kill -- -1'
expect deny  'kill 1'
expect deny  'systemctl --user exit'
expect deny  'systemctl --user stop default.target'
expect deny  'loginctl terminate-user kuroneko2539'
# Normal, scoped kills stay allowed.
expect allow 'kill 1957868'
expect allow 'kill -9 12345; echo done'
expect allow 'kill %1'
expect allow 'docker kill ff3d6bc6992c'
expect allow 'ps -eo pid,comm,args --no-headers | awk '"'"'$2=="bash"'"'"' | grep -F "deliver=true" | grep -F "abc" | awk '"'"'{print $1}'"'"' | xargs -r kill'
expect allow 'pkill -f "/home/x/AdvGame-wt-E/tools/run.sh"'
expect allow 'for p in $(pgrep -x make); do [ "$(readlink /proc/$p/cwd)" = "$PWD" ] && echo $p; done'
expect allow 'ps -o pid,ppid,comm -p 123'
expect allow 'systemctl --user restart claude-watchdog'
expect allow 'kill 10; echo ok'
expect allow 'kill -1 12345'
expect allow 'cat > notes.md <<EOF
never run kill $(ps -o ppid= -p X)
EOF'
expect allow 'kill $(ps -o ppid= -p 1) # kill-guard-ok'
# Prose that mentions ppid and kill is not a kill (2026-10-26 false positive on a log write).
expect allow 'echo "- Session crash: kill of systemd --user — ppid-kill took it down" >> notes.md'
expect allow 'git commit -m "kill guard: block ppid kills"'
expect deny  'if true; then kill $(ps -o ppid= -p 5); fi'
expect deny  'sudo kill -9 -1'
echo "deny-dangerous-kill: $pass passed, $fail failed"
[ $fail -eq 0 ]
