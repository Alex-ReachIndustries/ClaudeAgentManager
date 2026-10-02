#!/usr/bin/env bash
# Tests the watchdog auto-nudge: the pure decision (every safeguard, two-sighting confirm,
# cooldown) and agentHasHealthyMonitor against real processes (socket stdout vs file stdout).
set -u
cd "$(dirname "$0")/../.."
node -e "
const {spawn,spawnSync}=require('child_process'); const fs=require('fs'); const IS_LINUX=true;
$(sed -n '/^const DEAF_THRESHOLD/p;/^const AUTO_NUDGE_COOLDOWN/p;/^const AUTO_NUDGE_CONFIRM_GAP/p;/^const AUTO_NUDGE_MIN_IDLE_MIN/p' scripts/watchdog.js)
$(sed -n '/^function autoNudgeDecision/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function agentHasHealthyMonitor/,/^}/p' scripts/watchdog.js)
const now=10_000_000_000, M=60000;
const base={isCam:false,midTurn:false,sinceTurn:10,oldestDeliveredAgeMs:15*M,healthyMonitor:true,blocked:false,ids:[1,2],lastNudgeAt:0,candidate:null,now};
const armed={since:now-60000,ids:[1,2]};
const cases=[
 ['first sighting arms, does not nudge', {}, 'arm'],
 ['second sighting 60s later nudges', {candidate:armed}, 'nudge'],
 ['second sighting only 30s later waits', {candidate:{since:now-30000,ids:[1,2]}}, 'none'],
 ['stale sighting (its messages were acked, new ones queued) re-arms', {candidate:{since:now-60000,ids:[9]}}, 'arm'],
 ['mid-turn: no', {midTurn:true,candidate:armed}, 'none'],
 ['turn ended 2 min ago: no', {sinceTurn:2,candidate:armed}, 'none'],
 ['no done line (unknown idle): no', {sinceTurn:null,candidate:armed}, 'none'],
 ['messages only 8 min old: no', {oldestDeliveredAgeMs:8*M,candidate:armed}, 'none'],
 ['unhealthy watcher (shell/orphan): no', {healthyMonitor:false,candidate:armed}, 'none'],
 ['permission prompt or menu on screen: no', {blocked:true,candidate:armed}, 'none'],
 ['nudged 10 min ago (cooldown): no', {lastNudgeAt:now-10*M,candidate:armed}, 'none'],
 ['nudged 40 min ago: yes', {lastNudgeAt:now-40*M,candidate:armed}, 'nudge'],
 ['never nudges Cam', {isCam:true,candidate:armed}, 'none'],
 ['no messages: no', {ids:[],candidate:armed}, 'none'],
];
let pass=0;
for(const [n,over,want] of cases){const got=autoNudgeDecision({...base,...over}).action;const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  '+n+(ok?'':' (got '+got+')'));}
// Real processes: our own pid is the 'claude' parent.
const AG='feedc0de-0000-4000-8000-000000000001';
const sock=spawn('bash',['-c','exec -a \"poll deliver=true '+AG+'\" sleep 20'],{stdio:['ignore','pipe','ignore']});
const AG2='feedc0de-0000-4000-8000-000000000002';
const fd=fs.openSync('/tmp/claude-1000/autonudge-test.out','w');
const file=spawn('bash',['-c','exec -a \"poll deliver=true '+AG2+'\" sleep 20'],{stdio:['ignore',fd,'ignore']});
setTimeout(()=>{
  let extra=0;
  const a=agentHasHealthyMonitor(AG,process.pid); console.log((a?'PASS':'FAIL')+'  socket-stdout poller under the agent is healthy'); if(a)extra++;
  const b=agentHasHealthyMonitor(AG2,process.pid); console.log((!b?'PASS':'FAIL')+'  file-stdout (run_in_background) poller is NOT healthy'); if(!b)extra++;
  const c=agentHasHealthyMonitor(AG,1); console.log((!c?'PASS':'FAIL')+'  poller with a different parent (orphan) is NOT healthy'); if(!c)extra++;
  const d=agentHasHealthyMonitor('feedc0de-0000-4000-8000-00000000dead',process.pid); console.log((!d?'PASS':'FAIL')+'  no poller at all is NOT healthy'); if(!d)extra++;
  sock.kill(); file.kill();
  console.log((pass+extra)+'/'+(cases.length+4)+' passed');
  process.exitCode=(pass===cases.length&&extra===4)?0:1;
},500);
"
