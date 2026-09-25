#!/usr/bin/env bash
# The deaf check must stay quiet while an agent is mid-turn. Drives real tmux panes.
set -u
cd "$(dirname "$0")/../.."
S=cmtest-turn; tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -n deadbeef "printf '\xe2\x9c\xbd Perusing\xe2\x80\xa6 (4s \xc2\xb7 \xe2\x86\x93 124 tokens)\n\xe2\x9d\xaf \n'; sleep 30"
tmux new-window -t $S -n cafebabe "printf '\xe2\x9c\xb6 Tomfoolering\xe2\x80\xa6 (20m 18s \xc2\xb7 \xe2\x86\x93 11.2k tokens)\n\xe2\x9d\xaf \n'; sleep 30"
tmux new-window -t $S -n feedf00d "printf '\xe2\x9c\xbb Cogitated for 16s \xc2\xb7 done 11:50 \xc2\xb7 1 monitor still running\n\xe2\x9d\xaf \n'; sleep 30"
tmux new-window -t $S -n baddcafe "printf 'all done\n\xe2\x9d\xaf \n'; sleep 30"
sleep 1
node -e "
const {spawnSync}=require('child_process'); const IS_LINUX=true;
$(sed -n '/^function findAgentTmuxTarget/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function paneTurnInProgress/,/^}/p' scripts/watchdog.js)
const c=[['live spinner, seconds','deadbeef',true],['live spinner, minutes+seconds','cafebabe',true],['finished turn (done HH:MM)','feedf00d',false],['plain idle prompt','baddcafe',false]];
let p=0; for(const [n,id,w] of c){const g=paneTurnInProgress(findAgentTmuxTarget(id+'-x')); const ok=g===w; if(ok)p++; console.log((ok?'PASS':'FAIL')+'  '+n);}
process.exitCode=p===c.length?0:1;"
rc=$?; tmux kill-session -t $S; exit $rc
