#!/usr/bin/env bash
# Tests the watchdog's Claude usage parser (usageFromText): full and truncated footer wording,
# session vs weekly, reset text, and copies quoted in the transcript ignored.
set -u
cd "$(dirname "$0")/../.."
node -e "
$(sed -n '/^function usageFromText/,/^}/p' scripts/watchdog.js)
const SEP='─'.repeat(40);
const pane=(usage,extra='')=>['● some transcript line', extra, '✻ Brewed for 8s · done 12:40', usage, SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on · 1 monitor'].join('\n');
const cases=[
 ['weekly with reset', pane('  You\'ve used 86% of your weekly limit · resets Oct 28, 8am (Europe/London) ·…'), [{limit:'weekly',percent:86,resets:'Oct 28, 8am'}]],
 ['weekly truncated', pane('  You\'ve used 80% of your weekly lim… · ✔ Update installed · Restart to update'), [{limit:'weekly',percent:80,resets:null}]],
 ['session truncated', pane('  You\'ve used 99% of your session li… · ✔ Update installed · Restart to update'), [{limit:'session',percent:99,resets:null}]],
 ['session with reset', pane('  You\'ve used 95% of your session limit · resets 9:30am (Europe/London)'), [{limit:'session',percent:95,resets:'9:30am'}]],
 ['curly apostrophe', pane('  You’ve used 97% of your session limit'), [{limit:'session',percent:97,resets:null}]],
 ['no usage line', pane('                                        ✔ Update installed · Restart to update'), []],
 ['quoted in scrollback is ignored', 'You\'ve used 99% of your session limit\n'+Array(20).fill('line').join('\n')+'\n'+pane(''), []],
];
let pass=0,total=0;
for(const [n,t,want] of cases){total++;const got=JSON.stringify(usageFromText(t));const ok=got===JSON.stringify(want);if(ok)pass++;console.log((ok?'PASS':'FAIL')+'  '+n+(ok?'':' (got '+got+')'));}
console.log(pass+'/'+total+' passed');
process.exitCode=pass===total?0:1;
"
