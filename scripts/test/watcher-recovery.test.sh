#!/usr/bin/env bash
# Tests the watchdog watcher recovery: poller counting (loop only, subshells and one-off commands
# ignored) and the pure decision (3-min threshold, idle re-arm, busy heartbeat + queue, cooldowns,
# blocked panes, duplicate-poller stop), which duplicates get stopped, and the auto-ACK filter.
set -u
cd "$(dirname "$0")/../.."
node -e "
$(sed -n '/^const WATCHER_MISSING_MIN_MS/p;/^const WATCHER_NUDGE_COOLDOWN/p;/^const WATCHER_DUPE_ALERT_COOLDOWN/p' scripts/watchdog.js)
$(sed -n '/^function isPollerOf/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function pollerCount/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function pollersToStop/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function isAutoAckRelay/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function watcherRecoveryDecision/,/^}/p' scripts/watchdog.js)
const ID='48190218-145a-4035-ac4d-3de6791a817c', OTHER='a88a8d1c-475a-49a7-a48c-f6cfd336350f';
const loop=(id)=>'/bin/bash -c source snap.sh && eval \'while true; do resp=\$(curl -s \"http://x/api/agents/'+id+'/messages?status=pending&deliver=true\"); sleep 5; done\'';
let pass=0,total=0;
const check=(name,got,want)=>{total++;const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  '+name+(ok?'':' (got '+got+', want '+want+')'));};
check('count: one poller loop', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:loop(ID)}],ID), 1);
check('count: its \$(...) subshell is not a second poller', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:loop(ID)},{pid:11,ppid:10,comm:'bash',cmdline:loop(ID)}],ID), 1);
check('count: two independent loops', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:loop(ID)},{pid:20,ppid:2,comm:'bash',cmdline:loop(ID)}],ID), 2);
check('count: non-bash (curl) ignored', pollerCount([{pid:10,ppid:1,comm:'curl',cmdline:loop(ID)}],ID), 0);
check('count: another agent\'s poller ignored', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:loop(OTHER)}],ID), 0);
check('count: one-off ps|grep|kill check (no loop) ignored', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:'bash -c ps -eo pid,args | grep -F deliver=true | grep -F '+ID+' | xargs -r kill'}],ID), 0);
check('count: loop without deliver=true ignored', pollerCount([{pid:10,ppid:1,comm:'bash',cmdline:loop(ID).replace('deliver=true','limit=10')}],ID), 0);
const now=10_000_000_000, M=60000;
const base={pollers:0,zeroSince:now-4*M,multiSince:null,busy:false,blocked:false,lastNudgeAt:0,lastAlertAt:0,now};
const cases=[
 ['1 poller: nothing', {pollers:1,zeroSince:null}, 'none'],
 ['0 pollers for 1 min: below threshold', {zeroSince:now-1*M}, 'none'],
 ['0 pollers, first sighting (zeroSince=now)', {zeroSince:now}, 'none'],
 ['0 pollers 4 min, idle: re-arm', {}, 'rearm-idle'],
 ['0 pollers 3 min exactly, idle: re-arm', {zeroSince:now-3*M}, 'rearm-idle'],
 ['idle, nudged 10 min ago: cooldown', {lastNudgeAt:now-10*M}, 'none'],
 ['idle, nudged 31 min ago: re-arm again', {lastNudgeAt:now-31*M}, 'rearm-idle'],
 ['busy: heartbeat and queue', {busy:true}, 'heartbeat-and-queue'],
 ['busy, queued 10 min ago: heartbeat only', {busy:true,lastNudgeAt:now-10*M}, 'heartbeat'],
 ['blocked (prompt/compacting/limit wait): nothing', {blocked:true}, 'none'],
 ['blocked and busy: nothing', {blocked:true,busy:true}, 'none'],
 ['2 pollers for 1 min: below threshold', {pollers:2,zeroSince:null,multiSince:now-1*M}, 'none'],
 ['2 pollers for 4 min: stop dupes', {pollers:2,zeroSince:null,multiSince:now-4*M}, 'stop-dupes'],
 ['2 pollers, alerted 20 min ago: cooldown', {pollers:2,zeroSince:null,multiSince:now-4*M,lastAlertAt:now-20*M}, 'none'],
 ['3 pollers, acted 61 min ago: act again', {pollers:3,zeroSince:null,multiSince:now-90*M,lastAlertAt:now-61*M}, 'stop-dupes'],
];
for(const [n,over,want] of cases) check('decide: '+n, watcherRecoveryDecision({...base,...over}), want);
const CL=500, P=(pid,ppid,start,id)=>({pid,ppid,start,comm:'bash',cmdline:loop(id||ID)});
const s=(a)=>JSON.stringify(a);
check('stop: two own pollers -> the older', s(pollersToStop([P(10,CL,100),P(20,CL,200)],ID,CL)), s([10]));
check('stop: order by start, not pid', s(pollersToStop([P(30,CL,100),P(20,CL,200)],ID,CL)), s([30]));
check('stop: three own -> two oldest', s(pollersToStop([P(10,CL,300),P(20,CL,100),P(30,CL,200)],ID,CL)), s([20,30]));
check('stop: one own -> nothing', s(pollersToStop([P(10,CL,100)],ID,CL)), s([]));
check('stop: orphan (parent not claude) never stopped', s(pollersToStop([P(10,1,100),P(20,CL,200)],ID,CL)), s([]));
check('stop: subshell of own loop is not own (ppid is the loop)', s(pollersToStop([P(10,CL,100),P(11,10,101)],ID,CL)), s([]));
check('stop: other agent ignored', s(pollersToStop([P(10,CL,100,OTHER),P(20,CL,200)],ID,CL)), s([]));
check('ack: stored [ACK from X]: reply', isAutoAckRelay('[ACK from AIGroupPortal - PM]: E R28 zip ready'), true);
check('ack: delivered form with relay banner', isAutoAckRelay('[\u2194 RELAY FROM AGENT \"a21b9fae\" — a peer]\n\n[ACK from AIGroupPortal - PM]: noted'), true);
check('ack: ordinary relay is not an ack', isAutoAckRelay('PM -> B: please fix the label [ACK from nobody]: x'), false);
check('ack: watchdog alert is not an ack', isAutoAckRelay('[WATCHDOG] Sonnet B appears DEAF'), false);
check('ack: null content', isAutoAckRelay(null), false);
console.log(pass+'/'+total+' passed');
process.exit(pass===total?0:1);
"
