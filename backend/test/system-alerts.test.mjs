// System alerts: pure decision logic + the /api/system endpoints, against a RUNNING backend.
//
// Run it INSIDE an isolated test container (never against the live stack: the usage POSTs
// emit real alerts, which would push to the user's phone):
//   docker compose -p alerttest -f docker-compose.yml -f <override mapping a temp data dir and
//     backend/test at /app/test, on another host port> up -d --build --no-deps backend
//   docker exec -e API_KEY=<key> alerttest-backend-1 node test/system-alerts.test.mjs
// Env: ALERT_TEST_URL (default http://localhost:3001), API_KEY.
import {
  fleetSilenceDecision, usageAlertDecision, usageWindowKey, isoWeekKey, parseSqliteUtc,
  FLEET_SILENT_MS, FLEET_SILENT_REPEAT_MS, reportUsage,
} from "../dist/system-alerts.js";

// A session reset label ("9:30am") recurs on later days: a sent key must expire with its window.
if (process.env.SKIP_REPORT_USAGE !== "1") {
  const t0 = new Date("2026-10-26T08:00:00Z");
  const r1 = reportUsage("session", 95, "9:30am", t0);
  const r2 = reportUsage("session", 96, "9:30am", new Date(t0.getTime() + 30 * 60_000));
  const r3 = reportUsage("session", 95, "9:30am", new Date(t0.getTime() + 24 * 3600_000));
  console.log(`  ${r1 && !r2 && r3 ? "PASS" : "FAIL"} recurring session reset label re-alerts next day (${r1},${r2},${r3})`);
  if (!(r1 && !r2 && r3)) process.exitCode = 1;
}

const BASE = process.env.ALERT_TEST_URL || "http://localhost:3001";
const KEY = process.env.API_KEY || "";
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
}
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

console.log("\n## fleetSilenceDecision");
const MIN = 60_000, T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
const fresh = { alerted: false, lastAlertAt: null };
ok(fleetSilenceDecision([], T0, 0, fresh).action === "none", "no live agents: no alert");
ok(fleetSilenceDecision([T0 - 5 * MIN], T0, 0, fresh).action === "none", "checked in 5 min ago: none");
ok(fleetSilenceDecision([T0 - 16 * MIN], T0, 0, fresh).action === "silent", "16 min silent: alert");
ok(fleetSilenceDecision([T0 - 16 * MIN, T0 - 2 * MIN], T0, 0, fresh).action === "none", "one agent fresh: none");
ok(fleetSilenceDecision([T0 - 16 * MIN], T0, 0, fresh).silentMinutes === 16, "reports silent minutes");
ok(fleetSilenceDecision([T0 - 3 * 60 * MIN], T0, T0 - 5 * MIN, fresh).action === "none", "backend just started: start time counts as a check-in");
ok(fleetSilenceDecision([T0 - 3 * 60 * MIN], T0, T0 - 16 * MIN, fresh).action === "silent", "15+ min after start still silent: alert");
const alerted = { alerted: true, lastAlertAt: T0 - 10 * MIN };
ok(fleetSilenceDecision([T0 - 30 * MIN], T0, 0, alerted).action === "none", "already alerted 10 min ago: no repeat");
ok(fleetSilenceDecision([T0 - 90 * MIN], T0 + FLEET_SILENT_REPEAT_MS, 0, alerted).action === "silent", "repeat after an hour");
ok(fleetSilenceDecision([T0 - 1 * MIN], T0, 0, alerted).action === "recovered", "check-in after alert: recovered");
ok(fleetSilenceDecision([], T0, 0, alerted).action === "none", "all archived: no recovered yet");
ok(FLEET_SILENT_MS === 15 * MIN, "threshold is 15 min");
ok(parseSqliteUtc("2026-10-26 14:52:14") === Date.UTC(2026, 9, 26, 14, 52, 14), "SQLite datetime parsed as UTC");

console.log("\n## usageAlertDecision");
let sent = new Set();
let d = usageAlertDecision("session", 94, "w1", sent);
ok(d.threshold === null, "94%: nothing");
d = usageAlertDecision("session", 95, "w1", sent);
ok(d.threshold === 95, "95%: alert 95");
d.markSent.forEach((k) => sent.add(k));
ok(usageAlertDecision("session", 96, "w1", sent).threshold === null, "96% after 95 sent: quiet");
d = usageAlertDecision("session", 99, "w1", sent);
ok(d.threshold === 99, "99%: alert 99");
d.markSent.forEach((k) => sent.add(k));
ok(usageAlertDecision("session", 100, "w1", sent).threshold === null, "100% after 99 sent: quiet");
ok(usageAlertDecision("session", 95, "w2", sent).threshold === 95, "new window re-arms");
ok(usageAlertDecision("weekly", 95, "w1", sent).threshold === 95, "weekly is independent of session");
sent = new Set();
d = usageAlertDecision("weekly", 99, "w", sent);
ok(d.threshold === 99 && d.markSent.length === 2, "jump straight to 99: only 99 sent, 95 marked too");
d.markSent.forEach((k) => sent.add(k));
ok(usageAlertDecision("weekly", 95, "w", sent).threshold === null, "then 95 stays quiet");
ok(usageWindowKey("session", "9:30am", new Date()) === "9:30am", "window = reset text when given");
ok(usageWindowKey("session", undefined, new Date(Date.UTC(2026, 9, 26, 3))) === "2026-10-26", "session window = UTC day");
ok(isoWeekKey(new Date(Date.UTC(2026, 9, 26))) === "2026-W44", "ISO week of 2026-10-26 is W44");
ok(usageWindowKey("weekly", "", new Date(Date.UTC(2026, 0, 1))) === "2026-W01", "weekly window = ISO week");

console.log("\n## /api/system endpoints");
let r = await api("GET", "/api/system/alerts");
ok(r.status === 200 && Array.isArray(r.json), "GET alerts is a list", r);
const before = r.json?.length ?? 0;
r = await api("POST", "/api/system/alerts/usage", { limit: "monthly", percent: 95 });
ok(r.status === 400, "bad limit: 400", r);
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 95.5 });
ok(r.status === 400, "non-integer percent: 400", r);
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 101 });
ok(r.status === 400, "percent > 100: 400", r);
const win = `test-${Date.now()}`;
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 90, resets: win });
ok(r.status === 200 && r.json?.alerted === false, "90%: not alerted", r);
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 95, resets: win });
ok(r.status === 200 && r.json?.alerted === true, "95%: alerted", r);
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 95, resets: win });
ok(r.status === 200 && r.json?.alerted === false, "95% again: deduped", r);
r = await api("POST", "/api/system/alerts/usage", { limit: "session", percent: 99, resets: win });
ok(r.status === 200 && r.json?.alerted === true, "99%: alerted", r);
r = await api("GET", "/api/system/alerts");
const mine = (r.json || []).filter((a) => a.id.includes(win.toLowerCase()));
ok(r.json?.length === before + 2 && mine.length === 2, "two new alerts listed", r.json?.slice(0, 3));
ok(mine[0]?.title === "Session limit 99% used" && mine[0]?.severity === "critical", "newest first: 99% critical", mine[0]);
ok(mine[1]?.title === "Session limit 95% used" && mine[1]?.severity === "warning", "then 95% warning", mine[1]);
ok(mine.every((a) => a.kind === "usage" && typeof a.created_at === "string" && /resets test-/.test(a.message)), "contract fields present", mine);

console.log(`\nsystem-alerts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
