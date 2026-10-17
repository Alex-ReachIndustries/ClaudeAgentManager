#!/usr/bin/env bash
# Tests the watchdog auto-compact: footer parsing (current and older wording, scrollback ignored)
# and the pure decision (threshold, idle, blocked, helper running, two-sighting confirm, cooldown).
set -u
cd "$(dirname "$0")/../.."
node -e "
$(sed -n '/^const AUTO_COMPACT_MAX_PCT/p;/^const AUTO_COMPACT_MIN_IDLE_MIN/p;/^const AUTO_COMPACT_CONFIRM_GAP/p;/^const AUTO_COMPACT_COOLDOWN/p' scripts/watchdog.js)
$(sed -n '/^function contextLeftPctFromText/,/^}/p' scripts/watchdog.js)
$(sed -n '/^function autoCompactDecision/,/^}/p' scripts/watchdog.js)
const SEP='─'.repeat(40);
const pane=(footer,extra='')=>['● some transcript line', extra, '✻ Brewed for 8s · done 12:40', footer, SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on · 1 monitor'].join('\n');
const parse=[
 ['current footer', pane('                                   6% until auto-compact'), 6],
 ['older footer wording', pane('  Context left until auto-compact: 7%'), 7],
 ['no footer (plenty of context)', pane(''), null],
 ['footer only in scrollback is ignored', '7% until auto-compact\n'+Array(20).fill('line').join('\n')+'\n'+pane(''), null],
 ['launcher text in the input box does not hide it', pane('  5% until auto-compact').replace('❯ ','❯ keep up the good work, no need to acknowledge this, just wanted to let you\n  know all is well'), 5],
];
let pass=0, total=0;
for(const [n,t,want] of parse){total++;const got=contextLeftPctFromText(t);const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  parse: '+n+(ok?'':' (got '+got+')'));}
const now=10_000_000_000, M=60000;
const base={pct:6,midTurn:false,blocked:false,sinceTurn:10,helperRunning:false,lastCompactAt:0,candidate:null,now};
const armed={since:now-60000};
const cases=[
 ['first sighting arms, does not compact', {}, 'arm'],
 ['second sighting 60s later compacts', {candidate:armed}, 'compact'],
 ['second sighting only 30s later waits', {candidate:{since:now-30000}}, 'none'],
 ['8% (at threshold) compacts', {pct:8,candidate:armed}, 'compact'],
 ['12% left: no', {pct:12,candidate:armed}, 'none'],
 ['no footer: no', {pct:null,candidate:armed}, 'none'],
 ['mid-turn: no', {midTurn:true,candidate:armed}, 'none'],
 ['turn ended 1 min ago: no', {sinceTurn:1,candidate:armed}, 'none'],
 ['no done line (unknown idle): no', {sinceTurn:null,candidate:armed}, 'none'],
 ['prompt, menu or usage-limit wait on screen: no', {blocked:true,candidate:armed}, 'none'],
 ['agent already running its own /compact-context: no', {helperRunning:true,candidate:armed}, 'none'],
 ['compacted 30 min ago (cooldown): no', {lastCompactAt:now-30*M,candidate:armed}, 'none'],
 ['compacted 61 min ago: yes', {lastCompactAt:now-61*M,candidate:armed}, 'compact'],
];
for(const [n,over,want] of cases){total++;const got=autoCompactDecision({...base,...over}).action;const ok=got===want;if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  decide: '+n+(ok?'':' (got '+got+')'));}
console.log(pass+'/'+total+' passed');
process.exitCode=pass===total?0:1;
"
