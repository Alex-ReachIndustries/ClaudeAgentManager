// Peer review of Knowledge Hub proposals, and lifecycle hygiene.
//
// Review replaces human approval as the NORMAL path (the human/Cam decide endpoint still
// works as an override). Two agreeing votes from distinct agents who did not propose the
// item decide it: 2 approves → accepted through the existing decideProposal; 2 rejects →
// rejected; a split waits for a third vote.
//
// Distribution: every 10 min a sweep hands each pending item that still needs votes to an
// idle, live agent (one outstanding request per agent, none within 30 min of the last,
// same-project-as-proposer preferred), as an ordinary relay-style message so it is delivered
// and acked like any other.
//
// Lifecycle: once a week, approved entries nobody has used in 60 days get a 'retire' review,
// entries with volatile references (shas, PR numbers, paths) unverified for 90 days get a
// 'verify' review, and a digest of stale "knowledge wanted" gaps goes to Cam.
import { getDb, addMessage, getSetting, setSetting } from "../db.js";
import { broadcast } from "../sse.js";
import { publishAgentMessage } from "../mqtt.js";
import { logger } from "../logger.js";
import { createProposal, decideProposal, getPending, listReviews, makeSnippet, revisePending } from "./store.js";
import { classifyEntry } from "./categories.js";

export const KB_PURPOSE =
  "PURPOSE: the Knowledge Hub is how this fleet — every agent, Cam included — evolves and learns; every lesson you record makes every future agent better, so feeding it is part of doing great work, not overhead.";

const VOTES_TO_DECIDE = 2;
const REVIEW_PEER_NAME = "kb-review";
const LIFECYCLE_PEER_NAME = "kb-lifecycle";
const LIFECYCLE_AGENT = "kb-lifecycle";

// ─── Identity ──────────────────────────────────────────────────────────────

/**
 * Every name an agent may have been recorded under. proposing_agent is whatever the caller
 * sent (usually its id, sometimes its title), so "is this the proposer?" must match any of them.
 */
function identities(agent: string): Set<string> {
  const ids = new Set<string>([agent.trim().toLowerCase()]);
  try {
    const row = getDb().prepare(
      "SELECT id, title, base_title FROM agents WHERE id = ? OR title = ? OR base_title = ? LIMIT 1"
    ).get(agent, agent, agent) as { id: string; title: string | null; base_title: string | null } | undefined;
    if (row) for (const v of [row.id, row.title, row.base_title]) if (v && v.trim()) ids.add(v.trim().toLowerCase());
  } catch { /* identity lookup is best-effort */ }
  return ids;
}

export function isProposer(pending: Record<string, unknown>, agent: string): boolean {
  const p = String(pending.proposing_agent ?? "").trim().toLowerCase();
  return !!p && identities(agent).has(p);
}

// ─── Review queue + votes ─────────────────────────────────────────────────

const VOTE_HOWTO = (pendingId: number) =>
  `curl -s -X POST "$AGENT_URL/api/kb/pending/${pendingId}/review" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -H "X-Agent-Id: $CLAUDE_AGENT_ID" -d '{"verdict":"approve","note":"<one line why>"}'` +
  ` — verdict: approve | reject | edit. For edit, also send the improved fields ("title","body","tags"); an edit counts as your approval and the improved version needs one more independent approve.`;

/** The oldest pending item this agent may review: not its own, not already voted on. */
export function reviewQueue(agent: string): Record<string, unknown> | null {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.id, p.proposing_agent FROM knowledge_pending p
    WHERE p.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM kb_reviews r WHERE r.pending_id = p.id AND r.agent = ?)
    ORDER BY p.created_at ASC, p.id ASC
    LIMIT 50
  `).all(agent) as { id: number; proposing_agent: string | null }[];
  for (const r of rows) {
    if (isProposer(r as unknown as Record<string, unknown>, agent)) continue;
    const item = getPending(r.id);
    if (item) return { ...item, how_to_vote: VOTE_HOWTO(r.id) };
  }
  return null;
}

export type ReviewOutcome =
  | { ok: true; status: "pending" | "accepted" | "rejected"; votes: { approve: number; reject: number }; decided_by?: string }
  | { ok: false; code: 400 | 403 | 404 | 409; error: string };

/** Cast a vote; decides the proposal once two votes agree. */
export function submitReview(
  pendingId: number,
  agent: string,
  verdict: "approve" | "reject" | "edit",
  note?: string | null,
  revision?: { title?: string; body?: string; tags?: string[] },
): ReviewOutcome {
  const db = getDb();
  const pending = db.prepare("SELECT * FROM knowledge_pending WHERE id = ?").get(pendingId) as Record<string, unknown> | undefined;
  if (!pending) return { ok: false, code: 404, error: `Pending proposal ${pendingId} not found` };
  if (pending.status !== "pending") return { ok: false, code: 409, error: `Proposal ${pendingId} is already decided (${pending.status})` };
  if (isProposer(pending, agent)) return { ok: false, code: 403, error: "You proposed this item — the proposer cannot review their own proposal" };
  if (verdict === "edit") {
    // EDIT = "accept, with my improvements". Only content proposals can be revised.
    const kind = String(pending.kind);
    if (kind !== "new" && kind !== "edit") return { ok: false, code: 400, error: `A '${kind}' proposal has no content to edit — vote approve or reject` };
    if (!revision || (revision.title == null && revision.body == null && revision.tags == null)) {
      return { ok: false, code: 400, error: "verdict 'edit' needs at least one of title, body, tags" };
    }
    const already = db.prepare("SELECT 1 FROM kb_reviews WHERE pending_id = ? AND agent = ?").get(pendingId, agent);
    if (already) return { ok: false, code: 409, error: `You already reviewed proposal ${pendingId}` };
    revisePending(pendingId, revision);
    // Earlier approvals were for the old text, so they no longer count: the improved version
    // needs one more independent approve. (Rejects stay: a reject is a reason to look again.)
    db.prepare("DELETE FROM kb_reviews WHERE pending_id = ? AND verdict = 'approve'").run(pendingId);
    note = `[edited] ${note ?? ""}`.trim();
  }
  const voteVerdict = verdict === "edit" ? "approve" : verdict;
  try {
    db.prepare("INSERT INTO kb_reviews (pending_id, agent, verdict, note) VALUES (?, ?, ?, ?)")
      .run(pendingId, agent, voteVerdict, note ?? null);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return { ok: false, code: 409, error: `You already reviewed proposal ${pendingId}` };
    }
    throw err;
  }

  const reviews = listReviews(pendingId);
  const approvers = reviews.filter((r) => r.verdict === "approve").map((r) => r.agent);
  const rejecters = reviews.filter((r) => r.verdict === "reject").map((r) => r.agent);
  const votes = { approve: approvers.length, reject: rejecters.length };

  let decision: "accept" | "reject" | null = null;
  let voters: string[] = [];
  if (approvers.length >= VOTES_TO_DECIDE) { decision = "accept"; voters = approvers.slice(0, VOTES_TO_DECIDE); }
  else if (rejecters.length >= VOTES_TO_DECIDE) { decision = "reject"; voters = rejecters.slice(0, VOTES_TO_DECIDE); }
  if (!decision) return { ok: true, status: "pending", votes };

  const decidedBy = `peer-review:${voters.join(",")}`;
  const notes = reviews.filter((r) => voters.includes(r.agent) && r.note).map((r) => `${r.agent}: ${r.note}`).join(" | ");
  const result = decideProposal(pendingId, { decision, decidedBy, note: notes || undefined });
  if (!result) return { ok: true, status: "pending", votes }; // raced with a human decision
  logger.info({ pendingId, decision, decidedBy }, "KB proposal decided by peer review");
  // Same follow-up as a human accept: file a newly approved/edited entry into the category tree.
  const kind = String(pending.kind);
  if (decision === "accept" && result.entry_id != null && (kind === "new" || kind === "edit")) {
    classifyEntry(result.entry_id).catch((err) => logger.warn({ err, id: result.entry_id }, "KB classifyEntry after peer review failed"));
  }
  return { ok: true, status: decision === "accept" ? "accepted" : "rejected", votes, decided_by: decidedBy };
}

// ─── Distribution sweep ──────────────────────────────────────────────────

/** Send a relay-style message from a named KB service (delivered + acked like any relay). */
function sendServiceMessage(agentId: string, content: string, peerName: string): number | null {
  try {
    const res = addMessage(agentId, content, "agent", undefined, 0, peerName, "standard");
    broadcast("message-queued", { agentId, content, priority: 0, source: "agent", source_peer_name: peerName });
    publishAgentMessage(agentId, content, "agent");
    return Number(res.lastInsertRowid);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), agentId }, "KB service message failed");
    return null;
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + " …" : s;
}

/** The body section of a review request: full text for 'new', a diff summary for the rest. */
function describeChange(p: Record<string, unknown>): string {
  const kind = String(p.kind);
  const cur = String(p.current_body ?? "");
  if (kind === "new") return `BODY:\n${String(p.proposed_body ?? cur)}`;
  if (kind === "retire" || kind === "verify") {
    return `ENTRY #${p.entry_id} CURRENT BODY:\n${clip(cur, 1500)}`;
  }
  // edit
  const parts: string[] = [];
  if (p.proposed_title != null && p.proposed_title !== p.current_title) parts.push(`TITLE: "${p.current_title}" → "${p.proposed_title}"`);
  const prop = p.proposed_body != null ? String(p.proposed_body) : null;
  if (prop != null && prop !== cur) {
    if (prop.startsWith(cur.trimEnd())) parts.push(`APPENDS to entry #${p.entry_id}:\n${prop.slice(cur.trimEnd().length).trim()}`);
    else parts.push(`PROPOSED BODY (replaces current):\n${prop}\n\nCURRENT BODY (for comparison):\n${clip(cur, 800)}`);
  }
  for (const f of ["tags", "systems"] as const) {
    const nv = p[`proposed_${f}`];
    if (nv != null && JSON.stringify(nv) !== JSON.stringify(p[`current_${f}`])) parts.push(`${f.toUpperCase()}: ${JSON.stringify(p[`current_${f}`])} → ${JSON.stringify(nv)}`);
  }
  return parts.length ? parts.join("\n\n") : "(no content change)";
}

export function buildReviewRequest(p: Record<string, unknown>): string {
  const id = Number(p.id);
  const kind = String(p.kind);
  const title = String(p.proposed_title ?? p.current_title ?? "(untitled)");
  const conflicts = Array.isArray(p.conflict_flags) ? (p.conflict_flags as { entry_id: number; note: string }[]) : [];
  const votes = (p.votes as { approve: number; reject: number } | undefined) ?? { approve: 0, reject: 0 };
  const kindLine = kind === "new" ? "new entry" : `${kind} entry #${p.entry_id}`;
  const askFor = kind === "retire"
    ? "APPROVE = retire it (unused/obsolete: no view, inline or search hit in 60 days). REJECT = keep it (say why it's still needed)."
    : kind === "verify"
      ? "APPROVE = it is still accurate (check the shas/PRs/paths it names against the live system). REJECT = it's stale — then propose a kind:'edit' fix."
      : "APPROVE only if ALL hold: (1) useful to MULTIPLE agents, (2) accurate (verify volatile facts live), (3) rule-first — the first line is the actionable rule, (4) concise, (5) not a duplicate (/kb it), (6) durable knowledge, not ephemeral status.";
  return [
    `[KB REVIEW REQUEST] pending #${id} — ${kindLine}: "${title}"`,
    KB_PURPOSE,
    `You're idle, so you were picked as a peer reviewer. Two agreeing votes decide it (so far: ${votes.approve} approve, ${votes.reject} reject).`,
    "",
    describeChange(p),
    p.rationale ? `\nRATIONALE: ${String(p.rationale)}` : "",
    conflicts.length ? `\nCONFLICT FLAGS: ${conflicts.map((c) => c.note).join("; ")}` : "",
    "",
    `CRITERIA: ${askFor}`,
    `VOTE: ${VOTE_HOWTO(id)}`,
    "FIXABLE? Vote reject with a note saying exactly what to change, then propose the fix yourself (kind:'edit' with entry_id, or append:\"…\" to add a line to an existing entry).",
    "Ack this message, vote, then return to idle. A one-line completion is enough.",
  ].filter((l) => l !== "").join("\n");
}

/** One distribution pass. Returns the number of review requests sent. */
export function distributeReviews(): number {
  const db = getDb();
  const items = db.prepare(
    "SELECT id, proposing_agent FROM knowledge_pending WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 100"
  ).all() as { id: number; proposing_agent: string | null }[];
  if (items.length === 0) return 0;

  // Live idle agents: idle, heartbeat within 10 min (idle already excludes archived).
  const candidates = db.prepare(`
    SELECT id, title, base_title, project_id FROM agents
    WHERE status = 'idle' AND last_update_at >= datetime('now', '-10 minutes')
    ORDER BY last_update_at DESC
  `).all() as { id: string; title: string | null; base_title: string | null; project_id: string | null }[];
  if (candidates.length === 0) return 0;

  // Busy reviewers: asked in the last 30 min, or holding an unanswered request (24h expiry).
  const busy = new Set((db.prepare(`
    SELECT DISTINCT q.agent FROM kb_review_requests q
    LEFT JOIN knowledge_pending p ON p.id = q.pending_id
    WHERE q.created_at >= datetime('now', '-30 minutes')
       OR (q.created_at >= datetime('now', '-24 hours') AND p.status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM kb_reviews r WHERE r.pending_id = q.pending_id AND r.agent = q.agent))
  `).all() as { agent: string }[]).map((r) => r.agent));

  const askedFor = db.prepare("SELECT agent FROM kb_review_requests WHERE pending_id = ?");
  const outstandingFor = db.prepare(`
    SELECT COUNT(*) c FROM kb_review_requests q
    WHERE q.pending_id = ? AND q.created_at >= datetime('now', '-24 hours')
      AND NOT EXISTS (SELECT 1 FROM kb_reviews r WHERE r.pending_id = q.pending_id AND r.agent = q.agent)
  `);
  const proposerProject = db.prepare("SELECT project_id FROM agents WHERE id = ? OR title = ? OR base_title = ? LIMIT 1");
  const record = db.prepare("INSERT INTO kb_review_requests (pending_id, agent, message_id) VALUES (?, ?, ?)");

  let sent = 0;
  for (const item of items) {
    const p = getPending(item.id);
    if (!p) continue;
    const votes = p.votes as { approve: number; reject: number };
    // Votes still needed for a decision: 0/0 → 2; 1/1 → 1; 1/0 or 0/1 → 1.
    const needed = votes.approve === votes.reject ? VOTES_TO_DECIDE - votes.approve : 1;
    let open = needed - Number((outstandingFor.get(item.id) as { c: number }).c);
    if (open <= 0) continue;

    const reviewed = new Set(listReviews(item.id).map((r) => r.agent));
    const asked = new Set((askedFor.all(item.id) as { agent: string }[]).map((r) => r.agent));
    const proj = item.proposing_agent
      ? ((proposerProject.get(item.proposing_agent, item.proposing_agent, item.proposing_agent) as { project_id: string | null } | undefined)?.project_id ?? null)
      : null;
    const eligible = candidates
      .filter((c) => !busy.has(c.id) && !reviewed.has(c.id) && !asked.has(c.id) && !isProposer(p, c.id))
      // Prefer reviewers from the proposer's project (they can judge it best); stable otherwise.
      .sort((a, b) => Number(!!proj && b.project_id === proj) - Number(!!proj && a.project_id === proj));

    for (const c of eligible) {
      if (open <= 0) break;
      const msgId = sendServiceMessage(c.id, buildReviewRequest(p), REVIEW_PEER_NAME);
      if (msgId == null) continue;
      record.run(item.id, c.id, msgId);
      busy.add(c.id);
      open--;
      sent++;
    }
  }
  if (sent) logger.info({ sent }, "KB review requests distributed");
  return sent;
}

// ─── Lifecycle hygiene ───────────────────────────────────────────────────

const LIFECYCLE_KEY = "kb_lifecycle_last_run";
const LIFECYCLE_EVERY_DAYS = 7;
const LIFECYCLE_CAP = 15;

// Volatile references that rot: git shas (need a digit AND a letter, so plain words like
// "defaced" and plain numbers don't count), PR numbers, and file paths (absolute, ~/, ./ or a
// relative path with an extension). API routes (/api/...) are not file paths.
const SHA_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const PR_RE = /\bPR\s*#\d+/i;
const PATH_RE = /(?:^|[\s`'"(])(?:~|\.{1,2})?\/(?!api\/)[\w.-]+\/[\w./-]+|\b[\w-]+(?:\/[\w.-]+)+\.[a-z0-9]{1,5}\b/i;

export function hasVolatileRefs(body: string): boolean {
  return SHA_RE.test(body) || PR_RE.test(body) || PATH_RE.test(body);
}

/** Approved entries ids used (view/inline/cite/related, or a search result) within `days`. */
function usedEntryIds(days: number): Set<number> {
  const db = getDb();
  const since = `-${days} days`;
  const used = new Set<number>();
  for (const r of db.prepare(
    "SELECT DISTINCT entry_id FROM kb_access_log WHERE entry_id IS NOT NULL AND action IN ('view','inline','inline_suppressed','cite','related') AND ts >= datetime('now', ?)"
  ).all(since) as { entry_id: number }[]) used.add(Number(r.entry_id));
  for (const r of db.prepare(
    "SELECT DISTINCT CAST(j.value AS INTEGER) id FROM kb_access_log a, json_each(a.result_ids) j WHERE a.action = 'search' AND a.result_ids IS NOT NULL AND a.ts >= datetime('now', ?)"
  ).all(since) as { id: number }[]) used.add(Number(r.id));
  return used;
}

export interface LifecycleResult { ran: boolean; retire: number[]; verify: number[]; wanted_digest: number }

/** One lifecycle pass. Acts at most once per 7 days unless force=true. */
export function runLifecycle(force = false): LifecycleResult {
  const none: LifecycleResult = { ran: false, retire: [], verify: [], wanted_digest: 0 };
  const last = getSetting(LIFECYCLE_KEY);
  if (!force && last) {
    const lastMs = Date.parse(last);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < LIFECYCLE_EVERY_DAYS * 86400_000) return none;
  }
  const db = getDb();
  // Never stack a second review on an entry: skip entries with an open lifecycle item, or one
  // decided in the last 90 days (reviewers already said keep / still accurate).
  const recentlyReviewed = new Set((db.prepare(`
    SELECT DISTINCT entry_id FROM knowledge_pending
    WHERE kind IN ('retire','verify') AND entry_id IS NOT NULL
      AND (status = 'pending' OR decided_at >= datetime('now', '-90 days'))
  `).all() as { entry_id: number }[]).map((r) => Number(r.entry_id)));

  // Retire: approved, >30 days old, no use in 60 days. Least-used first.
  const used = usedEntryIds(60);
  const retire: number[] = [];
  for (const e of db.prepare(`
    SELECT id, title, hit_count, created_at FROM knowledge_entries
    WHERE status = 'approved' AND created_at < datetime('now', '-30 days')
    ORDER BY hit_count ASC, created_at ASC
  `).all() as { id: number; title: string; hit_count: number; created_at: string }[]) {
    if (retire.length >= LIFECYCLE_CAP) break;
    if (used.has(e.id) || recentlyReviewed.has(e.id)) continue;
    createProposal({
      kind: "retire", entry_id: e.id, agent: LIFECYCLE_AGENT,
      rationale: `Unused: no view, inline, citation or search-result hit in 60 days (created ${e.created_at}, ${e.hit_count} lifetime reads). Approve to retire (status → superseded); reject to keep.`,
    });
    retire.push(e.id);
    recentlyReviewed.add(e.id);
  }

  // Verify: approved, body names volatile refs, verified_at older than 90 days (or never).
  const verify: number[] = [];
  for (const e of db.prepare(`
    SELECT id, body, verified_at FROM knowledge_entries
    WHERE status = 'approved' AND (verified_at IS NULL OR verified_at < datetime('now', '-90 days'))
    ORDER BY COALESCE(verified_at, '') ASC, id ASC
  `).all() as { id: number; body: string; verified_at: string | null }[]) {
    if (verify.length >= LIFECYCLE_CAP) break;
    if (recentlyReviewed.has(e.id) || !hasVolatileRefs(String(e.body ?? ""))) continue;
    createProposal({
      kind: "verify", entry_id: e.id, agent: LIFECYCLE_AGENT,
      rationale: `Names volatile references (git shas / PR numbers / file paths) and was last verified ${e.verified_at ?? "never"}. Approve if still accurate; reject if stale (then propose an edit).`,
    });
    verify.push(e.id);
  }

  // Stale "knowledge wanted" gaps → one digest to Cam (skipped if there is no Cam).
  let wantedDigest = 0;
  const wanted = db.prepare(`
    SELECT id, query, times, first_seen, note FROM kb_wanted
    WHERE status = 'open' AND first_seen < datetime('now', '-14 days')
    ORDER BY times DESC, first_seen ASC LIMIT 25
  `).all() as { id: number; query: string; times: number; first_seen: string; note: string | null }[];
  if (wanted.length) {
    const cam = db.prepare(`
      SELECT id FROM agents WHERE title = 'Cam' OR base_title = 'Cam' OR role = 'cam-linux'
      ORDER BY (status = 'archived') ASC, last_update_at DESC LIMIT 1
    `).get() as { id: string } | undefined;
    if (cam) {
      const lines = wanted.map((w) => `- #${w.id} "${makeSnippet(w.query, 120)}" ×${w.times} (open since ${w.first_seen.slice(0, 10)})${w.note ? ` — ${makeSnippet(w.note, 100)}` : ""}`);
      const content = [
        `[KB WANTED DIGEST] ${wanted.length} knowledge gap(s) open for 14+ days`,
        KB_PURPOSE,
        "",
        ...lines,
        "",
        "For each: get the answer written up (assign it, or answer it yourself) and propose it with its wanted_id (POST $AGENT_URL/api/kb/propose {...,\"wanted_id\":N}) — or, if it isn't worth filling, dismiss it: POST $AGENT_URL/api/kb/wanted/<id>/decide {\"status\":\"dismissed\",\"by\":\"Cam\"}.",
      ].join("\n");
      if (sendServiceMessage(cam.id, content, LIFECYCLE_PEER_NAME) != null) wantedDigest = wanted.length;
    }
  }

  setSetting(LIFECYCLE_KEY, new Date().toISOString());
  logger.info({ retire: retire.length, verify: verify.length, wantedDigest }, "KB lifecycle pass done");
  return { ran: true, retire, verify, wanted_digest: wantedDigest };
}

// ─── Schedulers ──────────────────────────────────────────────────────────

let started = false;

/** Start the review-distribution sweep (10 min) and the lifecycle check (24h; acts weekly). */
export function startKbReviewSchedulers(): void {
  if (started || process.env.KB_SCHEDULERS === "off") return;
  started = true;
  const safe = (name: string, fn: () => unknown) => () => {
    try { fn(); } catch (err) { logger.error({ err }, `KB ${name} failed`); }
  };
  // Message-based distribution is OFF by default: agents now pull reviews themselves in the
  // background (the Stop-hook review check). Set KB_REVIEW_SWEEP=on to re-enable messaging.
  if (process.env.KB_REVIEW_SWEEP === "on") setInterval(safe("review distribution", distributeReviews), 10 * 60 * 1000);
  // First lifecycle check shortly after boot (restarts must not starve it), then daily.
  setTimeout(safe("lifecycle", () => runLifecycle()), 10 * 60 * 1000);
  setInterval(safe("lifecycle", () => runLifecycle()), 24 * 60 * 60 * 1000);
}
