#!/usr/bin/env bash
# Exercises the watchdog's usage-limit menu detection against real tmux panes.
# Needs tmux; creates and removes a throwaway session "cmtest-wedge".
set -u
cd "$(dirname "$0")/../.."
S=cmtest-wedge
MENU='What do you want to do?\n\xe2\x9d\xaf 1. Stop and wait for limit to reset\n  2. Wait here, then continue automatically shortly\n  3. Ask your admin for more usage\nEnter to confirm \xc2\xb7 Esc to cancel\n'
tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -n deadbeef "printf '$MENU'; read x; echo GOT:\$x; sleep 30"
tmux new-window -t $S -n cafebabe "printf '  \xe2\x9a\xa0 Usage limit reached \xc2\xb7 continuing shortly \xc2\xb7 esc to cancel\n'; sleep 30"
tmux new-window -t $S -n feedf00d "printf '$MENU'; for i in \$(seq 1 60); do echo line \$i; done; printf '\xe2\x9d\xaf \n'; sleep 30"
sleep 1
node -e "
const {spawnSync}=require('child_process'); const IS_LINUX=true;
$(sed -n '/^function findAgentTmuxTarget/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function paneShowsUsageLimitMenu/,/^}/p' scripts/watchdog.js)
const cases=[['live usage-limit menu','deadbeef',true],['already answered: continuing shortly','cafebabe',false],['old menu scrolled above a live prompt','feedf00d',false]];
let pass=0;
for(const [n,id,want] of cases){const t=findAgentTmuxTarget(id+'-x');const got=t?paneShowsUsageLimitMenu(t):null;const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  '+n);}
const t=findAgentTmuxTarget('deadbeef-x'); spawnSync('tmux',['send-keys','-t',t,'2']); spawnSync('tmux',['send-keys','-t',t,'Enter']);
process.exitCode = pass===cases.length ? 0 : 1;
"
rc=$?
sleep 1
if tmux capture-pane -p -t $S:deadbeef | grep -q 'GOT:2'; then echo "PASS  answer delivered option 2"; else echo "FAIL  answer not delivered"; rc=1; fi
tmux kill-session -t $S
exit $rc
