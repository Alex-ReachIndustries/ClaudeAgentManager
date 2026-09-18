// Replicates the watchdog's deaf-detection decision exactly, against synthetic message sets.
const DEAF_THRESHOLD = 12 * 60 * 1000;
function parseTimestamp(ts){ if(!ts) return 0; const t=Date.parse(String(ts).includes('Z')||String(ts).includes('+')?ts:ts.replace(' ','T')+'Z'); return isNaN(t)?0:t; }
function decide(messages){
  const real = messages.filter(m => m.source !== 'system' && !m.acknowledged_at);
  const oldest = list => list.reduce((acc,m)=>{ const t=parseTimestamp(m.delivered_at||m.created_at); return t && (!acc||t<acc)?t:acc; },0);
  const sp = real.filter(m=>m.status==='pending');
  const sd = real.filter(m=>m.status==='delivered' && m.delivered_at);
  const pa = sp.length ? Date.now()-oldest(sp) : 0;
  const da = sd.length ? Date.now()-oldest(sd) : 0;
  if (pa > DEAF_THRESHOLD) return 'NO_WATCHER';
  if (da > DEAF_THRESHOLD) return 'NOT_WAKING';
  return 'OK';
}
const ago = m => new Date(Date.now()-m*60000).toISOString().replace('T',' ').slice(0,19);
const cases = [
  ['healthy: nothing queued', [], 'OK'],
  ['recent pending (2m) — in flight, must NOT flag', [{status:'pending',source:'agent',created_at:ago(2)}], 'OK'],
  ['pending 20m — no watcher polling', [{status:'pending',source:'agent',created_at:ago(20)}], 'NO_WATCHER'],
  ['delivered+unacked 20m — watcher not waking', [{status:'delivered',source:'agent',delivered_at:ago(20)}], 'NOT_WAKING'],
  ['delivered 20m but ACKED — must NOT flag', [{status:'delivered',source:'agent',delivered_at:ago(20),acknowledged_at:ago(19)}], 'OK'],
  ['system-sourced 60m — never delivered by design, must NOT flag', [{status:'pending',source:'system',created_at:ago(60)}], 'OK'],
  ['the PM false-positive: acked but delivered_at null', [{status:'acknowledged',source:'agent',created_at:ago(60),acknowledged_at:ago(59)}], 'OK'],
  ['Sonnet B real case: 25 delivered+unacked, oldest 40m', Array.from({length:25},(_,i)=>({status:'delivered',source:'agent',delivered_at:ago(40-i)})), 'NOT_WAKING'],
];
let pass=0;
for (const [name,msgs,want] of cases){
  const got=decide(msgs);
  const ok=got===want;
  if(ok) pass++;
  console.log(`  ${ok?'PASS':'FAIL'}  ${name}  -> ${got}${ok?'':' (expected '+want+')'}`);
}
console.log(`\n  ${pass}/${cases.length} passed`);
process.exit(pass===cases.length?0:1);
