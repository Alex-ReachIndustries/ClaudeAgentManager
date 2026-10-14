// Knowledge Hub improvements — end-to-end test against a RUNNING backend.
//
// Run it INSIDE an isolated test container (never against the live stack): it writes test
// agents/entries, and rewinds timestamps directly in the SQLite file to simulate time passing.
//
//   docker compose -p kbtest -f docker-compose.yml -f <override mapping a temp data dir> up -d --build --no-deps backend
//   docker exec -e API_KEY=<key> kbtest-backend-1 node test/kb-improvements.test.mjs
//
// The override must mount backend/test at /app/test. Env: KB_TEST_URL (default
// http://localhost:3001), API_KEY, DB_PATH (default /app/data/agents.db).
import Database from "better-sqlite3";
import fs from "node:fs";
import { parseKbLine, citedEntryIds, updateText } from "../dist/knowledge/citations.js";
import { initKnowledgeSchema } from "../dist/knowledge/schema.js";

const BASE = process.env.KB_TEST_URL || "http://localhost:3001";
const KEY = process.env.API_KEY || "";
const DB_PATH = process.env.DB_PATH || "/app/data/agents.db";
if (!DB_PATH.startsWith("/app/data/")) throw new Error("refusing to run outside the container data dir");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

const RUN = Date.now().toString(36);
const ag = (n) => `kbt-${RUN}-${n}`;
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 400)}` : ""}`); }
}
function section(t) { console.log(`\n## ${t}`); }

async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEmbedded(ids, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const rows = db.prepare(`SELECT COUNT(*) c FROM knowledge_entries WHERE id IN (${ids.map(() => "?").join(",")}) AND embed_stale = 0 AND embedding IS NOT NULL`).get(...ids);
    if (rows.c === ids.length) return true;
    await sleep(500);
  }
  return false;
}

async function makeAgent(id, title, status = "working") {
  const r = await api("POST", `/api/agents/${id}/updates`, { type: "status", content: "test agent", title, status });
  if (r.status !== 200) throw new Error(`agent create failed ${r.status} ${JSON.stringify(r.json)}`);
}

/** Propose + human-accept → an approved, embedded entry. */
async function approvedEntry(title, body, agent = ag("seed")) {
  const p = await api("POST", "/api/kb/propose", { kind: "new", title, body, agent, rationale: "test fixture" });
  if (p.status !== 200) throw new Error(`fixture propose failed ${p.status} ${JSON.stringify(p.json)}`);
  const d = await api("POST", `/api/kb/pending/${p.json.pending_id}/decide`, { decision: "accept", decidedBy: "test-human" });
  if (d.status !== 200) throw new Error(`fixture decide failed ${d.status}`);
  return p.json.entry_id;
}

async function deliver(agentId) {
  const r = await api("GET", `/api/agents/${agentId}/messages?status=pending&deliver=true`);
  const msgs = Array.isArray(r.json) ? r.json : r.json?.messages ?? [];
  if (msgs.length) await api("POST", `/api/agents/${agentId}/messages/ack`, { ids: msgs.map((m) => m.id), content: "ack (test)" });
  return msgs;
}

// ─────────────────────────────────────────────────────────────────────────────

section("setup");
for (let i = 0; i < 60; i++) {
  const s = await api("GET", "/api/kb/stats");
  if (s.json?.embeddingsReady) break;
  await sleep(1000);
}
const [A, B, C, D, R, S, K, H, Z] = ["A", "B", "C", "D", "R", "S", "K", "H", "Z"].map(ag);
for (const id of [A, B, C, D, R, S, K, H, Z]) await makeAgent(id, `kbtest ${id.slice(-1)}`);

const E1 = await approvedEntry(
  "Regenerate the Gradle wrapper when gradlew is missing",
  "If gradlew is missing, regenerate it with the system Gradle 8.2 before building the Android APK.\nRun /opt/gradle/gradle-8.2/bin/gradle wrapper --gradle-version 8.2 --no-daemon inside android/, then ./gradlew assembleDebug.",
);
const E2 = await approvedEntry(
  "Billing service Postgres pool exhaustion",
  "When the billing service logs 'remaining connection slots are reserved', raise the pgbouncer pool, never max_connections.\nThe billing workers leak idle transactions under retry storms; pgbouncer transaction pooling absorbs them.",
);
const EINL = await approvedEntry(
  "Sourdough starter feeding schedule for the office kitchen bot",
  "Feed the office sourdough starter at 1:1:1 flour, water and starter every 12 hours at room temperature.\nDiscard half before each feeding; refrigerate between weekend bakes and feed twice before baking.",
);
ok(await waitEmbedded([E1, E2, EINL]), "fixture entries embedded");

// ── 1. Parsing (unit) ───────────────────────────────────────────────────────
section("KB: line parsing (unit)");
const kbCases = [
  ["done\nKB: [12, 40]", { kind: "ids", ids: [12, 40] }],
  ["done\nKB: [12] [40]", { kind: "ids", ids: [12, 40] }],
  ["- **KB:** [7]", { kind: "ids", ids: [7] }],
  ["KB: 12, 40", { kind: "ids", ids: [12, 40] }],
  ["KB: none", { kind: "none" }],
  ["KB: searched docker → none; proposed nothing reusable", { kind: "none" }],
  ["KB_CONSULTED: [12]", null],
  ["no record here", null],
  ["KB: searched stuff", null],
];
for (const [text, want] of kbCases) {
  ok(JSON.stringify(parseKbLine(text)) === JSON.stringify(want), `parseKbLine(${JSON.stringify(text)})`, parseKbLine(text));
}
ok(JSON.stringify(parseKbLine(updateText(JSON.stringify({ text: "did the thing\nKB: [3]" })))) === JSON.stringify({ kind: "ids", ids: [3] }), "KB line found inside stored JSON update content");
ok(JSON.stringify(citedEntryIds("see [12] and KB 40, kb#7, KB9")) === JSON.stringify([12, 40, 7, 9]), "citedEntryIds finds [N], KB N, KB#N, KBN", citedEntryIds("see [12] and KB 40, kb#7, KB9"));

// ── 2. Proposal gate ────────────────────────────────────────────────────────
section("proposal gate: size");
let r = await api("POST", "/api/kb/propose", { kind: "new", title: "x".repeat(121), body: "Rule.\nWhy.", agent: A });
ok(r.status === 400 && r.json?.field === "title" && r.json?.limit === 120, "title > 120 → 400 field=title", r);
r = await api("POST", "/api/kb/propose", { kind: "new", title: "Long body test", body: "Rule line.\n" + "y".repeat(3500), agent: A });
ok(r.status === 400 && r.json?.field === "body" && r.json?.limit === 3500 && !!r.json?.hint, "body > 3500 → 400 field=body with hint", r);
r = await api("POST", "/api/kb/propose", { kind: "new", title: "Long first line", body: "z".repeat(301) + "\nrest", agent: A });
ok(r.status === 400 && r.json?.field === "body first line" && r.json?.limit === 300, "first line > 300 → 400", r);
r = await api("POST", "/api/kb/propose", { kind: "new", title: "No body at all", agent: A });
ok(r.status === 400 && r.json?.field === "body", "kind new without body → 400", r);
r = await api("POST", "/api/kb/propose", { kind: "edit", entry_id: E1, append: "w".repeat(2400), agent: A });
ok(r.status === 400 && r.json?.field === "body" && /append/i.test(r.json?.hint ?? ""), "append pushing body over cap → 400 (cap applies to result)", r);
r = await api("POST", "/api/kb/propose", { kind: "edit", entry_id: 99999999, body: "x", agent: A });
ok(r.status === 404, "edit of missing entry → 404", r.status);

section("proposal gate: duplicate");
r = await api("POST", "/api/kb/propose", {
  kind: "new", agent: A,
  title: "Regenerate the Gradle wrapper when gradlew is missing",
  body: "If gradlew is missing, regenerate it with the system Gradle 8.2 before building the Android APK.\nRun /opt/gradle/gradle-8.2/bin/gradle wrapper --gradle-version 8.2 --no-daemon inside android/, then ./gradlew assembleDebug.",
});
ok(r.status === 409 && r.json?.duplicate_of?.id === E1 && /kind:'edit'/.test(r.json?.hint ?? ""), "near-duplicate → 409 duplicate_of + edit hint", r);
r = await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Rotate the TOTP master key", body: "Rotate the TOTP master key only with the stack stopped.\nThe key file is read once at boot." });
ok(r.status === 200 && r.json?.pending_id > 0, "distinct proposal passes the gate", r);

// ── 3. Peer review ──────────────────────────────────────────────────────────
section("peer review: 2 approves → accepted; proposer can't self-review");
const p1 = (await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Mosquitto ACL reload", body: "Reload mosquitto ACLs with SIGHUP, not a restart.\nA restart drops every retained agent session." })).json;
r = await api("POST", `/api/kb/pending/${p1.pending_id}/review`, { agent: A, verdict: "approve" });
ok(r.status === 403, "proposer self-review → 403", r);
r = await api("POST", `/api/kb/pending/${p1.pending_id}/review`, { agent: B, verdict: "approve", note: "useful" });
ok(r.status === 200 && r.json?.status === "pending" && r.json?.votes?.approve === 1, "first approve → still pending", r);
r = await api("POST", `/api/kb/pending/${p1.pending_id}/review`, { agent: B, verdict: "approve" });
ok(r.status === 409, "same reviewer twice → 409", r);
r = await api("POST", `/api/kb/pending/${p1.pending_id}/review`, { agent: C, verdict: "approve" });
ok(r.status === 200 && r.json?.status === "accepted" && r.json?.decided_by === `peer-review:${B},${C}`, "second approve → accepted, decided_by peer-review:B,C", r);
ok(db.prepare("SELECT status FROM knowledge_entries WHERE id = ?").get(p1.entry_id)?.status === "approved", "entry is approved");
ok(/peer-review:/.test(db.prepare("SELECT decided_note FROM knowledge_pending WHERE id = ?").get(p1.pending_id)?.decided_note ?? ""), "decided_note records peer-review");

section("peer review: 2 rejects → rejected; split waits");
const p2 = (await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Build is green on main today", body: "The build is green on main as of this morning.\nNothing else to note." })).json;
await api("POST", `/api/kb/pending/${p2.pending_id}/review`, { agent: B, verdict: "reject", note: "ephemeral status" });
r = await api("POST", `/api/kb/pending/${p2.pending_id}/review`, { agent: C, verdict: "reject" });
ok(r.json?.status === "rejected", "two rejects → rejected", r);
ok(db.prepare("SELECT status FROM knowledge_entries WHERE id = ?").get(p2.entry_id)?.status === "rejected", "entry is rejected");
const p3 = (await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Screen service coordinate scaling", body: "Pass the screenshot's scale factor back on every click.\nThe service maps scaled coordinates to native resolution." })).json;
await api("POST", `/api/kb/pending/${p3.pending_id}/review`, { agent: B, verdict: "approve" });
r = await api("POST", `/api/kb/pending/${p3.pending_id}/review`, { agent: C, verdict: "reject" });
ok(r.json?.status === "pending", "1 approve + 1 reject → still pending", r);
r = await api("POST", `/api/kb/pending/${p3.pending_id}/review`, { agent: D, verdict: "approve" });
ok(r.json?.status === "accepted", "third (approve) vote breaks the split → accepted", r);
r = await api("POST", `/api/kb/pending/${p3.pending_id}/review`, { agent: Z, verdict: "approve" });
ok(r.status === 409, "vote on decided item → 409", r);

section("human decide still works as override");
const p4 = (await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Prune dangling docker layers after builds", body: "Run docker image prune -f after every image build.\nIt only removes untagged intermediates." })).json;
await api("POST", `/api/kb/pending/${p4.pending_id}/review`, { agent: B, verdict: "approve" });
r = await api("POST", `/api/kb/pending/${p4.pending_id}/decide`, { decision: "reject", decidedBy: "human" });
ok(r.status === 200 && db.prepare("SELECT status FROM knowledge_pending WHERE id = ?").get(p4.pending_id)?.status === "rejected", "human reject overrides a pending peer vote", r);

// ── 4. Review queue ─────────────────────────────────────────────────────────
section("review queue exclusion");
const qa = (await api("POST", "/api/kb/propose", { kind: "new", agent: A, title: "Prefer git worktrees for parallel agents", body: "Give each parallel agent its own git worktree.\nShared checkouts race on branch switches." })).json;
const qb = (await api("POST", "/api/kb/propose", { kind: "new", agent: B, title: "Pin node major version in Dockerfiles", body: "Pin the node major in every Dockerfile FROM line.\nFloating tags broke onnxruntime once." })).json;
r = await api("GET", `/api/kb/review-queue?agent=${A}`);
const itemA = r.json?.data?.[0];
ok(r.status === 200 && itemA && itemA.proposing_agent !== A, "queue for A never returns A's own proposal", itemA?.proposing_agent);
ok(r.json?.data?.length <= 1, "queue returns at most one item");
ok(typeof itemA?.how_to_vote === "string" && itemA.how_to_vote.includes("/review"), "queue item carries how_to_vote");
// B votes on the oldest pending; its queue must move past it.
const oldestForB = (await api("GET", `/api/kb/review-queue?agent=${B}`)).json?.data?.[0];
await api("POST", `/api/kb/pending/${oldestForB.id}/review`, { agent: B, verdict: "approve" });
const nextForB = (await api("GET", `/api/kb/review-queue?agent=${B}`)).json?.data?.[0];
ok(!nextForB || (nextForB.id !== oldestForB.id && nextForB.proposing_agent !== B), "queue skips items B already reviewed and B's own", { oldest: oldestForB.id, next: nextForB?.id });
const viaHeader = await api("GET", "/api/kb/review-queue", undefined, { "X-Agent-Id": A });
ok(viaHeader.status === 200 && viaHeader.json?.data?.[0]?.proposing_agent !== A, "queue resolves agent from X-Agent-Id");
ok((await api("GET", "/api/kb/review-queue")).status === 400, "queue without agent → 400");
ok(Array.isArray((await api("GET", "/api/kb/pending")).json?.data?.[0]?.reviews), "GET /pending rows carry reviews[]");

// ── 5. Distribution sweep ───────────────────────────────────────────────────
section("review distribution sweep");
db.prepare("UPDATE agents SET status = 'working' WHERE id != ?").run(R);
db.prepare("UPDATE agents SET status = 'idle', last_update_at = datetime('now') WHERE id = ?").run(R);
r = await api("POST", "/api/kb/review-sweep", {});
ok(r.status === 200 && r.json?.sent >= 1, "sweep sends a request to the idle agent", r);
await api("POST", "/api/kb/review-sweep", {});
const reqs = db.prepare("SELECT content, source, source_peer_name FROM messages WHERE agent_id = ? AND source_peer_name = 'kb-review'").all(R);
ok(reqs.length === 1, "only one outstanding request per agent (second sweep sends none)", reqs.length);
ok(reqs[0]?.source === "agent", "request is a relay-style message (source=agent, delivered like any relay)", reqs[0]?.source);
ok(/^\[KB REVIEW REQUEST\]/.test(reqs[0]?.content ?? "") && (reqs[0]?.content ?? "").split("\n")[1].startsWith("PURPOSE: the Knowledge Hub is how this fleet"), "request starts with header then PURPOSE line");
ok(/CRITERIA:/.test(reqs[0]?.content ?? "") && /\/api\/kb\/pending\/\d+\/review/.test(reqs[0]?.content ?? ""), "request carries criteria + vote curl");
const delivered = await deliver(R);
ok(delivered.length === 1 && !/📌 APPLY/.test(delivered[0].content), "review request is delivered without a surfaced-KB block");

// ── 6. Lifecycle ────────────────────────────────────────────────────────────
section("lifecycle: retire / verify / wanted digest");
const ERET = await approvedEntry("Legacy fax gateway retry policy", "Retry the legacy fax gateway three times with a 30s gap.\nIt drops the first call after idle.");
const EVER = await approvedEntry("Watchdog deaf-alert fix location", "The deaf-alert priority fix lives in scripts/watchdog.js (PR #2094, commit 3fa9c2e).\nPriority must be an integer 0-10.");
db.prepare("UPDATE knowledge_entries SET created_at = datetime('now','-45 days') WHERE id = ?").run(ERET);
db.prepare("DELETE FROM kb_access_log WHERE entry_id = ?").run(ERET);
db.prepare("UPDATE knowledge_entries SET verified_at = datetime('now','-120 days') WHERE id = ?").run(EVER);
db.prepare("INSERT INTO kb_wanted (norm_query, query, first_seen) VALUES (?, ?, datetime('now','-20 days'))").run(`how to rotate mqtt passwords ${RUN}`, `how to rotate mqtt passwords ${RUN}`);
const CAM = ag("Cam");
await makeAgent(CAM, "Cam");
r = await api("POST", "/api/kb/lifecycle/run", { force: true });
ok(r.json?.ran && r.json.retire.includes(ERET), "unused 45-day-old entry enqueued for retire", r.json);
ok(r.json?.verify.includes(EVER), "entry with volatile refs + old verified_at enqueued for verify", r.json);
ok(!r.json?.retire.includes(E1), "recently created entries are not retired");
ok(r.json?.wanted_digest >= 1 && db.prepare("SELECT COUNT(*) c FROM messages WHERE agent_id = ? AND content LIKE '[KB WANTED DIGEST]%'").get(CAM).c === 1, "stale wanted items → one digest to Cam");
r = await api("POST", "/api/kb/lifecycle/run", {});
ok(r.json?.ran === false, "unforced re-run within 7 days is a no-op");
const retireP = db.prepare("SELECT id FROM knowledge_pending WHERE kind = 'retire' AND entry_id = ? AND status = 'pending'").get(ERET).id;
const verifyP = db.prepare("SELECT id FROM knowledge_pending WHERE kind = 'verify' AND entry_id = ? AND status = 'pending'").get(EVER).id;
await api("POST", `/api/kb/pending/${retireP}/review`, { agent: B, verdict: "approve" });
await api("POST", `/api/kb/pending/${retireP}/review`, { agent: C, verdict: "approve" });
ok(db.prepare("SELECT status FROM knowledge_entries WHERE id = ?").get(ERET).status === "superseded", "approved retire → entry superseded");
await api("POST", `/api/kb/pending/${verifyP}/review`, { agent: B, verdict: "approve" });
await api("POST", `/api/kb/pending/${verifyP}/review`, { agent: C, verdict: "approve" });
const ver = db.prepare("SELECT verified_at, (verified_at >= datetime('now','-1 minute')) fresh FROM knowledge_entries WHERE id = ?").get(EVER);
ok(ver.fresh === 1, "approved verify → verified_at = now", ver);
const EKEEP = await approvedEntry("Old but loved kiosk reboot trick", "Reboot the lobby kiosk by holding power for ten seconds.\nSoft reboot leaves the browser frozen.");
db.prepare("UPDATE knowledge_entries SET created_at = datetime('now','-45 days') WHERE id = ?").run(EKEEP);
db.prepare("DELETE FROM kb_access_log WHERE entry_id = ?").run(EKEEP);
const keepP = (await api("POST", "/api/kb/propose", { kind: "retire", entry_id: EKEEP, agent: A, rationale: "looks unused" })).json.pending_id;
await api("POST", `/api/kb/pending/${keepP}/review`, { agent: B, verdict: "reject" });
await api("POST", `/api/kb/pending/${keepP}/review`, { agent: C, verdict: "reject" });
ok(db.prepare("SELECT status FROM knowledge_entries WHERE id = ?").get(EKEEP).status === "approved", "rejected retire → entry left approved");

// ── 7. Inline suppression ───────────────────────────────────────────────────
section("inline suppression");
const INL_MSG = "Task: feed the office sourdough starter at 1:1:1 flour, water and starter every 12 hours at room temperature, discard half before each feeding.";
const BODY_MARK = "refrigerate between weekend bakes";
const POINTER = "(sent to you earlier this session; if it's no longer in your context";
const inlineCount = (action) => db.prepare("SELECT COUNT(*) c FROM kb_access_log WHERE agent = ? AND entry_id = ? AND action = ?").get(S, EINL, action).c;
async function sendAndDeliver(content) {
  await api("POST", `/api/agents/${S}/messages`, { content, source: "user" });
  const msgs = await deliver(S);
  return msgs.map((m) => m.content).join("\n");
}
let out = await sendAndDeliver(INL_MSG);
ok(out.includes(`[${EINL}]`) && out.includes(BODY_MARK), "first delivery inlines the body", out.slice(-600));
out = await sendAndDeliver(INL_MSG + " (again)");
ok(out.includes(`[${EINL}]`) && out.includes(POINTER) && !out.includes(BODY_MARK), "same context epoch → pointer, not body", out.slice(-500));
ok(inlineCount("inline_suppressed") === 1, "suppressed pointer logged as inline_suppressed");
// Context reset the real way: a compaction update marks rules due → next delivery re-inlines.
await api("POST", `/api/agents/${S}/updates`, { type: "text", content: "compacted", summary: "Context compacted", status: "working" });
out = await sendAndDeliver(INL_MSG + " (after compact)");
ok(out.includes(BODY_MARK) && !out.includes(POINTER), "after compaction (rules due) → body re-inlined");
out = await sendAndDeliver(INL_MSG + " (post-compact repeat)");
ok(out.includes(POINTER) && !out.includes(BODY_MARK), "and suppressed again within the new epoch");
// Epoch moves forward with no due flag: inline happened before rules_injected_at.
db.prepare("UPDATE kb_access_log SET ts = datetime('now','-10 minutes') WHERE agent = ? AND entry_id = ? AND action = 'inline'").run(S, EINL);
db.prepare("UPDATE agents SET rules_injected_at = datetime('now','-5 minutes'), rules_due_reason = NULL WHERE id = ?").run(S);
out = await sendAndDeliver(INL_MSG + " (epoch moved)");
ok(out.includes(BODY_MARK) && !out.includes(POINTER), "rules_injected_at moved past the last inline → body re-inlined");
// Older than 4h: inline after the epoch but > 4h ago (rules last injected 5h ago → also stale).
db.prepare("UPDATE agents SET rules_injected_at = datetime('now','-5 hours'), rules_due_reason = NULL WHERE id = ?").run(S);
db.prepare("UPDATE kb_access_log SET ts = datetime('now','-270 minutes') WHERE agent = ? AND entry_id = ? AND action = 'inline'").run(S, EINL);
out = await sendAndDeliver(INL_MSG + " (4h later)");
ok(out.includes(BODY_MARK) && !out.includes(POINTER), "inline older than 4h → body re-inlined");
// An entry the message already cites is not surfaced again.
db.prepare("UPDATE agents SET rules_injected_at = datetime('now'), rules_due_reason = NULL WHERE id = ?").run(S);
out = await sendAndDeliver(INL_MSG + ` — see [${EINL}]`);
ok(!out.includes("📌 APPLY"), "message citing [id] → that entry is not surfaced", out.slice(-300));

// ── 8. Attribution ──────────────────────────────────────────────────────────
section("X-Agent-Id attribution");
const q = `gradle wrapper missing ${RUN}`;
await api("GET", `/api/kb/search?q=${encodeURIComponent(q)}`, undefined, { "X-Agent-Id": H });
ok(db.prepare("SELECT agent FROM kb_access_log WHERE action = 'search' AND query = ?").get(q)?.agent === H, "search attributed from X-Agent-Id");
await api("GET", `/api/kb/${E1}`, undefined, { "X-Agent-Id": H });
ok(db.prepare("SELECT COUNT(*) c FROM kb_access_log WHERE action = 'view' AND entry_id = ? AND agent = ?").get(E1, H).c >= 1, "view attributed from X-Agent-Id");
r = await api("POST", "/api/kb/propose", { kind: "new", title: "Header-only proposer attribution check", body: "Send X-Agent-Id on every KB call.\nAnalytics credit the caller from it." }, { "X-Agent-Id": H });
ok(db.prepare("SELECT proposing_agent FROM knowledge_pending WHERE id = ?").get(r.json?.pending_id)?.proposing_agent === H, "proposal attributed from X-Agent-Id");
r = await api("POST", `/api/kb/pending/${r.json?.pending_id}/review`, { verdict: "approve" }, { "X-Agent-Id": H });
ok(r.status === 403, "header-only proposer still can't self-review", r);
const an = (await api("GET", "/api/kb/analytics?days=1")).json;
ok((an?.by_agent ?? []).some((x) => x.agent === "kbtest H" && x.searches >= 1), "analytics by_agent credits the header agent (resolved to its title)", (an?.by_agent ?? []).map((x) => x.agent));

// ── 9. Completion KB: line ─────────────────────────────────────────────────
section("completion KB: line");
const filler = "Implemented the change, rebuilt the image, ran the suite and verified the endpoint by hand. ".repeat(3);
const complete = (txt) => api("POST", `/api/agents/${K}/updates`, { type: "text", content: filler + "\n" + txt, summary: "done", status: "idle" });
r = await complete(`KB: [${E1}]`);
ok(r.status === 200 && !r.json?.kbReminder, "KB: [valid id] → no reminder", r.json?.kbReminder);
ok(db.prepare("SELECT COUNT(*) c FROM kb_access_log WHERE action = 'cite' AND agent = ? AND entry_id = ?").get(K, E1).c === 1, "valid id logged as a citation");
r = await complete("KB: none");
ok(!r.json?.kbReminder, "KB: none → no reminder (conscious decision)");
r = await complete("no record line at all");
ok(typeof r.json?.kbReminder === "string" && r.json.kbReminder.includes("KB: [id, id]") && r.json.kbReminder.includes("KB: none"), "missing KB line → reminder asks for the exact line", r.json?.kbReminder);
r = await complete("KB: [99999999]");
ok(/don't exist|none of the ids/i.test(r.json?.kbReminder ?? ""), "KB: [nonexistent] → reminder names the bad ids", r.json?.kbReminder);
const an2 = (await api("GET", "/api/kb/analytics?days=1")).json;
ok(an2?.uptake?.citation_rate > 0 && an2?.uptake?.kb_line_rate >= an2?.uptake?.citation_rate, "analytics citation_rate counts valid KB: [ids]", an2?.uptake);
ok(an2?.uptake?.inline_suppressed >= 1 && an2?.window_totals?.inline_suppressed >= 1, "analytics reports inline_suppressed savings");
ok(an2?.thresholds?.hit_min_sim === 0.60 && an2?.thresholds?.weak_max_sim > 0.60, "hit floor 0.60, weak band sits above it", an2?.thresholds);

// ── 10. Search: rule + relevance + gap + min_sim ───────────────────────────
section("search: rule, relevance, gap, min_sim");
r = await api("GET", `/api/kb/search?q=${encodeURIComponent("gradlew is missing, how do I regenerate the gradle wrapper for the android apk")}&agent=${H}`);
const top = r.json?.results?.[0];
ok(top?.id === E1 && top?.relevance === "strong" && r.json?.gap === false, "on-topic query → strong top result, gap=false", { top: top && { id: top.id, sim: top.sim, relevance: top.relevance }, gap: r.json?.gap });
ok(top?.rule === "If gradlew is missing, regenerate it with the system Gradle 8.2 before building the Android APK.", "result.rule = first body line", top?.rule);
ok(typeof top?.snippet === "string", "snippet kept for compatibility");
r = await api("GET", `/api/kb/search?q=${encodeURIComponent("quantum chromodynamics lattice gauge renormalization")}&agent=${H}`);
ok(r.json?.gap === true && (r.json?.results ?? []).every((x) => x.relevance === "weak") && !!r.json?.gap_hint, "off-topic query → all weak, gap=true + hint", { gap: r.json?.gap, sims: (r.json?.results ?? []).map((x) => x.sim) });
r = await api("GET", `/api/kb/search?q=${encodeURIComponent("gradle wrapper missing android")}&min_sim=0.99`);
ok((r.json?.results ?? []).every((x) => x.sim >= 0.99 || x.idMatch), "min_sim filters results", (r.json?.results ?? []).map((x) => x.sim));
r = await api("GET", `/api/kb/search?q=${encodeURIComponent(`KB ${E2}`)}`);
ok(r.json?.results?.[0]?.id === E2 && r.json.results[0].relevance === "strong", "exact id reference → strong");

// ── 11. Compact + batch fetch ───────────────────────────────────────────────
section("compact + batch fetch");
r = await api("GET", `/api/kb/${E1}?format=compact`);
ok(JSON.stringify(Object.keys(r.json ?? {}).sort()) === JSON.stringify(["body", "id", "status", "tags", "title", "verified_at"]), "format=compact returns exactly id,title,body,tags,status,verified_at", Object.keys(r.json ?? {}));
r = await api("GET", `/api/kb/${E1}`);
ok(r.status === 200 && !("embedding" in (r.json ?? {})), "default GET does not leak the embedding");
r = await api("GET", `/api/kb/batch?ids=${E1},${E2},99999999`);
ok(r.json?.data?.length === 2 && r.json.data[0].id === E1 && JSON.stringify(r.json.missing) === "[99999999]" && !("embedding" in r.json.data[0]), "batch returns compact entries in order + missing ids", r.json);
r = await api("GET", `/api/kb/batch?ids=${Array.from({ length: 11 }, (_, i) => i + 1).join(",")}`);
ok(r.status === 400, "batch > 10 ids → 400");
r = await api("GET", "/api/kb/batch?ids=abc");
ok(r.status === 400, "batch with junk ids → 400");

// ── 12. Append-style edit ──────────────────────────────────────────────────
section("append-style edit");
const before = db.prepare("SELECT body FROM knowledge_entries WHERE id = ?").get(E2).body;
r = await api("POST", "/api/kb/propose", { kind: "edit", entry_id: E2, append: "- Gotcha: pgbouncer must run in transaction mode, not session mode.", agent: A });
ok(r.status === 200, "append proposal accepted by the gate", r);
const ap = db.prepare("SELECT proposed_body FROM knowledge_pending WHERE id = ?").get(r.json?.pending_id);
ok(ap?.proposed_body === `${before.trimEnd()}\n\n- Gotcha: pgbouncer must run in transaction mode, not session mode.`, "proposed body = current body + appended paragraph");
ok((r.json?.conflicts ?? []).every((c) => c.entry_id !== E2), "an edit is not flagged as conflicting with its own entry");
await api("POST", `/api/kb/pending/${r.json.pending_id}/review`, { agent: B, verdict: "approve" });
await api("POST", `/api/kb/pending/${r.json.pending_id}/review`, { agent: C, verdict: "approve" });
ok(db.prepare("SELECT body FROM knowledge_entries WHERE id = ?").get(E2).body.endsWith("session mode."), "peer-approved append is applied to the entry");
r = await api("POST", "/api/kb/propose", { kind: "edit", entry_id: E2, append: "x", body: "y", agent: A });
ok(r.status === 400, "append + body together → 400");
r = await api("POST", "/api/kb/propose", { kind: "new", title: "t", body: "b", append: "x", agent: A });
ok(r.status === 400, "append on kind new → 400");

// ── 13. Listing ─────────────────────────────────────────────────────────────
section("listing without category");
const l1 = (await api("GET", "/api/kb/entries?status=approved&limit=2&offset=0")).json;
const l2 = (await api("GET", "/api/kb/entries?status=approved&limit=2&offset=2")).json;
ok(l1?.data?.length === 2 && l1.total >= 4 && l1.data.every((e) => e.status === "approved"), "status=approved paged listing", l1);
ok(l2?.data?.[0]?.id !== l1?.data?.[0]?.id && l2?.data?.[0]?.id > l1?.data?.[1]?.id, "offset pages forward");
ok(JSON.stringify(Object.keys(l1?.data?.[0] ?? {}).sort()) === JSON.stringify(["body", "id", "status", "tags", "title", "verified_at"]), "listing rows are compact");
ok((await api("GET", "/api/kb/entries")).json?.status === "approved", "no params → approved listing (no longer requires category)");
ok((await api("GET", "/api/kb/entries?status=bogus")).status === 400, "bad status → 400");

// ── 14. Migration (old schema) ─────────────────────────────────────────────
section("migration: knowledge_pending kind CHECK widened, idempotent");
const OLD = "/tmp/kbtest-old-schema.db";
for (const f of [OLD, OLD + "-wal", OLD + "-shm"]) { try { fs.unlinkSync(f); } catch { /* absent */ } }
const odb = new Database(OLD);
odb.exec(`
  CREATE TABLE knowledge_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', category TEXT DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '', systems TEXT NOT NULL DEFAULT '[]', source TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')), created_by_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), verified_at TEXT, supersedes_id INTEGER, related_ids TEXT NOT NULL DEFAULT '[]', hit_count INTEGER NOT NULL DEFAULT 0, embedding BLOB, embed_stale INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE knowledge_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'new' CHECK(kind IN ('new','edit')), proposed_title TEXT, proposed_body TEXT, proposed_category TEXT, proposed_tags TEXT, proposed_systems TEXT, proposed_source TEXT, proposing_agent TEXT, rationale TEXT DEFAULT '', conflict_flags TEXT NOT NULL DEFAULT '[]', review_flag INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','updated','rejected')), created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT, decided_note TEXT);
  CREATE TABLE agents (id TEXT PRIMARY KEY, title TEXT, base_title TEXT);
  INSERT INTO knowledge_entries (title, body, status) VALUES ('t', 'b', 'approved');
  INSERT INTO knowledge_pending (entry_id, kind, proposing_agent) VALUES (1, 'edit', 'x');
  INSERT INTO knowledge_pending (entry_id, kind, proposing_agent, status) VALUES (1, 'new', 'y', 'accepted');
`);
odb.pragma("foreign_keys = ON");
initKnowledgeSchema(odb);
initKnowledgeSchema(odb); // idempotent
const rows = odb.prepare("SELECT id, kind, proposing_agent, status, wanted_id FROM knowledge_pending ORDER BY id").all();
ok(rows.length === 2 && rows[0].proposing_agent === "x" && rows[1].status === "accepted", "existing pending rows preserved", rows);
let insertedRetire = false;
try { odb.prepare("INSERT INTO knowledge_pending (entry_id, kind) VALUES (1, 'retire')").run(); insertedRetire = true; } catch { /* CHECK */ }
ok(insertedRetire, "kind 'retire' now allowed");
ok(odb.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'knowledge_pending'").get()?.seq === 3, "autoincrement sequence carried over");
ok(!!odb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'kb_reviews'").get() && !!odb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_pending_status'").get(), "kb_reviews + pending index exist");
ok(odb.pragma("foreign_key_check").length === 0 && odb.pragma("foreign_keys", { simple: true }) === 1, "foreign keys intact and re-enabled");
odb.close();
for (const f of [OLD, OLD + "-wal", OLD + "-shm"]) { try { fs.unlinkSync(f); } catch { /* absent */ } }

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
