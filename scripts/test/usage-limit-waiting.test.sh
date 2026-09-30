#!/usr/bin/env bash
# Checks that the watchdog recognises an agent sitting out a usage limit (and nothing else).
# Needs tmux; creates and removes a throwaway session "cmtest-waiting".
set -u
cd "$(dirname "$0")/../.."
S=cmtest-waiting
FOOT='\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\n\xe2\x9d\xaf \n\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\n'
tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -n aaaa0001 "printf '$FOOT  \xe2\x9a\xa0 Usage limit reached \xc2\xb7 continuing shortly \xc2\xb7 esc to cancel\n  \xe2\x8f\xb5\xe2\x8f\xb5 bypass permissions on\n'; sleep 30"
tmux new-window -t $S -n aaaa0002 "printf 'Usage limit reached \xc2\xb7 continuing shortly\n'; for i in \$(seq 1 20); do echo work \$i; done; printf '$FOOT  \xe2\x8f\xb5\xe2\x8f\xb5 bypass permissions on \xc2\xb7 1 monitor\n'; sleep 30"
tmux new-window -t $S -n aaaa0003 "printf '\xe2\x97\x8f Fixing the rate limit handling in the API client\n$FOOT  \xe2\x8f\xb5\xe2\x8f\xb5 bypass permissions on \xc2\xb7 1 monitor\n'; sleep 30"
tmux new-window -t $S -n aaaa0004 "printf '$FOOT  \xe2\x8f\xb5\xe2\x8f\xb5 bypass permissions on \xc2\xb7 1 shell\n'; sleep 30"
sleep 1
node -e "
const {spawnSync}=require('child_process'); const IS_LINUX=true;
$(sed -n '/^function findAgentTmuxTarget/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function paneWaitingOnUsageLimit/,/^}/p' scripts/watchdog.js)
const cases=[
  ['waiting out a usage limit','aaaa0001',true],
  ['old banner scrolled away, now working','aaaa0002',false],
  ['agent merely talking about rate limits','aaaa0003',false],
  ['ordinary idle pane','aaaa0004',false],
  ['no pane at all',null,false]];
let pass=0;
for(const [n,id,want] of cases){const t=id?findAgentTmuxTarget(id+'-x'):null;const got=paneWaitingOnUsageLimit(t);const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  '+n);}
process.exitCode = pass===cases.length ? 0 : 1;
"
rc=$?
tmux kill-session -t $S
exit $rc
