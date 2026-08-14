// Knowledge Hub data-access layer. Wraps better-sqlite3 with prepared-statement
// helpers and keeps the FTS5 shadow tables (knowledge_fts / profiles_fts) in sync
// on every insert/update/delete. Vectors live in the `embedding` BLOB columns and
// are (re)computed by the background embedder whenever embed_stale = 1.
import { getDb } from "../db.js";
import { bufferToVector } from "./embeddings.js";
import { logger } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConflictFlag {
  entry_id: number;
  title: string;
  note: string;
}

export interface ProposalInput {
  kind: "new" | "edit";
  entry_id?: number | null;
  title?: string;
  body?: string;
  category?: string;
  tags?: string[];
  systems?: string[];
  source?: string;
  agent?: string;
  rationale?: string;
  conflicts?: ConflictFlag[];
  wanted_id?: number | null;   // the "knowledge wanted" gap this proposal fills (auto-resolved on approval)
}

export interface DecisionInput {
  decision: "accept" | "update" | "reject";
  edits?: Partial<{ title: string; body: string; category: string; tags: string[]; systems: string[]; source: string }>;
  note?: string;
  decidedBy?: string;
}

export interface ProfileInput {
  name: string;
  aliases?: string[];
  role?: string;
  org?: string;
  relationships?: string;
  summary?: string;
  addFact?: { fact: string; source?: string; by?: string };
  by?: string;
}

export interface VectorEntry {
  id: number;
  title: string;
  body: string;
  status: string;
  tags: string[];
  systems: string[];
  vec: Float32Array;
}

export interface VectorProfile {
  id: number;
  name: string;
  summary: string;
  vec: Float32Array;
}

// ─── Small helpers ─────────────────────────────────────────────────────────

function parseArr(v: unknown): string[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function keywordsFor(title: string, tags: string[], systems: string[]): string {
  return [title, ...tags, ...systems].join(" ").trim();
}

// FTS text uses readable, space-joined tags (not JSON) so MATCH works naturally.
function syncEntryFts(id: number, title: string, body: string, keywords: string, tags: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM knowledge_fts WHERE rowid = ?").run(id);
  db.prepare(
    "INSERT INTO knowledge_fts(rowid, title, body, keywords, tags) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, body, keywords, tags.join(" "));
}

function deleteEntryFts(id: number): void {
  getDb().prepare("DELETE FROM knowledge_fts WHERE rowid = ?").run(id);
}

function syncProfileFts(id: number, name: string, summary: string, facts: unknown): void {
  const db = getDb();
  const factText = Array.isArray(facts)
    ? facts.map((f) => (f && typeof f === "object" ? String((f as { fact?: string }).fact ?? "") : String(f))).join(" ")
    : String(facts ?? "");
  db.prepare("DELETE FROM profiles_fts WHERE rowid = ?").run(id);
  db.prepare(
    "INSERT INTO profiles_fts(rowid, name, summary, facts) VALUES (?, ?, ?, ?)"
  ).run(id, name, summary, factText);
}

/** Map a raw knowledge_entries row into a JSON-friendly shape (arrays parsed). */
export function mapEntry(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  return {
    ...row,
    tags: parseArr(row.tags),
    systems: parseArr(row.systems),
    related_ids: parseArr(row.related_ids),
    embedding: undefined, // never ship the raw BLOB
  };
}

function mapProfile(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  let facts: unknown = [];
  try { facts = JSON.parse(String(row.facts ?? "[]")); } catch { facts = []; }
  return {
    ...row,
    aliases: parseArr(row.aliases),
    facts,
    embedding: undefined,
  };
}

// ─── Proposals ───────────────────────────────────────────────────────────────

/**
 * Create a proposal.
 *  - kind 'new':  inserts a pending knowledge_entries row (+ FTS) and a matching
 *                 knowledge_pending row referencing it.
 *  - kind 'edit': inserts only a knowledge_pending row carrying the proposed_* fields
 *                 for an existing entry_id.
 * Returns the affected entry id (for 'new') and the pending queue id.
 */
export function createProposal(input: ProposalInput): { entry_id: number | null; pending_id: number } {
  const db = getDb();
  const conflicts = input.conflicts ?? [];
  const reviewFlag = conflicts.length > 0 ? 1 : 0;
  const conflictsJson = JSON.stringify(conflicts);

  const tx = db.transaction(() => {
    let entryId: number | null = input.entry_id ?? null;

    if (input.kind === "new") {
      const title = input.title ?? "";
      const body = input.body ?? "";
      const tags = input.tags ?? [];
      const systems = input.systems ?? [];
      const keywords = keywordsFor(title, tags, systems);
      const res = db.prepare(`
        INSERT INTO knowledge_entries (title, body, category, tags, keywords, systems, source, status, created_by_agent, embed_stale)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)
      `).run(
        title, body, input.category ?? "", JSON.stringify(tags), keywords,
        JSON.stringify(systems), input.source ?? "", input.agent ?? null
      );
      entryId = Number(res.lastInsertRowid);
      syncEntryFts(entryId, title, body, keywords, tags);
    }

    const pres = db.prepare(`
      INSERT INTO knowledge_pending
        (entry_id, kind, proposed_title, proposed_body, proposed_category, proposed_tags, proposed_systems, proposed_source, proposing_agent, rationale, conflict_flags, review_flag, wanted_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId, input.kind,
      input.title ?? null, input.body ?? null, input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.systems ? JSON.stringify(input.systems) : null,
      input.source ?? null, input.agent ?? null, input.rationale ?? "",
      conflictsJson, reviewFlag, input.wanted_id ?? null
    );

    return { entry_id: entryId, pending_id: Number(pres.lastInsertRowid) };
  });

  return tx();
}

// ─── Entries ─────────────────────────────────────────────────────────────────

/** Fetch an entry and bump its hit_count. Returns undefined if not found. */
export function getEntry(id: number): Record<string, unknown> | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM knowledge_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE knowledge_entries SET hit_count = hit_count + 1 WHERE id = ?").run(id);
  return mapEntry(row);
}

/** Approved + pending entries that already have an embedding, for vector search. */
export function listEntriesForVector(): VectorEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, body, status, tags, systems, embedding
    FROM knowledge_entries
    WHERE status IN ('approved','pending') AND embedding IS NOT NULL
  `).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    status: String(r.status ?? ""),
    tags: parseArr(r.tags),
    systems: parseArr(r.systems),
    vec: bufferToVector(r.embedding as Buffer),
  }));
}

export function listProfilesForVector(): VectorProfile[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, summary, embedding FROM people_profiles WHERE embedding IS NOT NULL
  `).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ""),
    summary: String(r.summary ?? ""),
    vec: bufferToVector(r.embedding as Buffer),
  }));
}

// ─── Pending queue ─────────────────────────────────────────────────────────

/** List pending proposals with the current + proposed content joined in. */
export function listPending(): Record<string, unknown>[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.*, e.title AS current_title, e.body AS current_body, e.status AS entry_status,
           e.category AS current_category, e.tags AS current_tags, e.systems AS current_systems
    FROM knowledge_pending p
    LEFT JOIN knowledge_entries e ON e.id = p.entry_id
    WHERE p.status = 'pending'
    ORDER BY p.review_flag DESC, p.created_at ASC
  `).all() as Record<string, unknown>[];
  return rows.map(shapePending);
}

export function getPending(id: number): Record<string, unknown> | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT p.*, e.title AS current_title, e.body AS current_body, e.status AS entry_status,
           e.category AS current_category, e.tags AS current_tags, e.systems AS current_systems
    FROM knowledge_pending p
    LEFT JOIN knowledge_entries e ON e.id = p.entry_id
    WHERE p.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? shapePending(row) : undefined;
}

function shapePending(row: Record<string, unknown>): Record<string, unknown> {
  let conflicts: unknown = [];
  try { conflicts = JSON.parse(String(row.conflict_flags ?? "[]")); } catch { conflicts = []; }
  return {
    ...row,
    conflict_flags: conflicts,
    proposed_tags: row.proposed_tags != null ? parseArr(row.proposed_tags) : null,
    proposed_systems: row.proposed_systems != null ? parseArr(row.proposed_systems) : null,
    current_tags: row.current_tags != null ? parseArr(row.current_tags) : null,
    current_systems: row.current_systems != null ? parseArr(row.current_systems) : null,
  };
}

/** Raw (unshaped) pending row — internal use for decisions. */
function getPendingRaw(id: number): Record<string, unknown> | undefined {
  return getDb().prepare("SELECT * FROM knowledge_pending WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

/**
 * Decide a proposal.
 *  accept → approve the entry; for 'edit', apply the proposed_* fields as-is.
 *  update → apply the human's `edits` over the entry, then approve.
 *  reject → for 'new' mark the entry rejected; for 'edit' just close the proposal.
 * Content changes set embed_stale = 1 and re-sync FTS.
 */
export function decideProposal(id: number, d: DecisionInput): { ok: boolean; entry_id: number | null } | null {
  const db = getDb();
  const pending = getPendingRaw(id);
  if (!pending || pending.status !== "pending") return null;

  const entryId = pending.entry_id != null ? Number(pending.entry_id) : null;
  const kind = String(pending.kind);
  const noteParts: string[] = [];
  if (d.decidedBy) noteParts.push(`by ${d.decidedBy}`);
  if (d.note) noteParts.push(d.note);
  const decidedNote = noteParts.join(": ") || null;

  const applyEntryUpdate = (fields: Partial<{ title: string; body: string; category: string; tags: string[]; systems: string[]; source: string }>) => {
    if (entryId == null) return;
    const cur = db.prepare("SELECT * FROM knowledge_entries WHERE id = ?").get(entryId) as Record<string, unknown> | undefined;
    if (!cur) return;
    const title = fields.title ?? String(cur.title ?? "");
    const body = fields.body ?? String(cur.body ?? "");
    const category = fields.category ?? String(cur.category ?? "");
    const tags = fields.tags ?? parseArr(cur.tags);
    const systems = fields.systems ?? parseArr(cur.systems);
    const source = fields.source ?? String(cur.source ?? "");
    const keywords = keywordsFor(title, tags, systems);
    db.prepare(`
      UPDATE knowledge_entries
      SET title = ?, body = ?, category = ?, tags = ?, keywords = ?, systems = ?, source = ?,
          updated_at = datetime('now'), updated_by = ?, embed_stale = 1
      WHERE id = ?
    `).run(title, body, category, JSON.stringify(tags), keywords, JSON.stringify(systems), source, d.decidedBy ?? null, entryId);
    syncEntryFts(entryId, title, body, keywords, tags);
  };

  const tx = db.transaction(() => {
    let pendingStatus: string;

    if (d.decision === "accept") {
      if (kind === "edit") {
        applyEntryUpdate({
          title: pending.proposed_title != null ? String(pending.proposed_title) : undefined,
          body: pending.proposed_body != null ? String(pending.proposed_body) : undefined,
          category: pending.proposed_category != null ? String(pending.proposed_category) : undefined,
          tags: pending.proposed_tags != null ? parseArr(pending.proposed_tags) : undefined,
          systems: pending.proposed_systems != null ? parseArr(pending.proposed_systems) : undefined,
          source: pending.proposed_source != null ? String(pending.proposed_source) : undefined,
        });
      }
      if (entryId != null) {
        db.prepare("UPDATE knowledge_entries SET status = 'approved', verified_at = datetime('now') WHERE id = ?").run(entryId);
      }
      pendingStatus = "accepted";
    } else if (d.decision === "update") {
      applyEntryUpdate(d.edits ?? {});
      if (entryId != null) {
        db.prepare("UPDATE knowledge_entries SET status = 'approved', verified_at = datetime('now') WHERE id = ?").run(entryId);
      }
      pendingStatus = "updated";
    } else {
      // reject
      if (kind === "new" && entryId != null) {
        db.prepare("UPDATE knowledge_entries SET status = 'rejected' WHERE id = ?").run(entryId);
      }
      pendingStatus = "rejected";
    }

    db.prepare(
      "UPDATE knowledge_pending SET status = ?, decided_at = datetime('now'), decided_note = ? WHERE id = ?"
    ).run(pendingStatus, decidedNote, id);

    // (c) Close the gap→fill loop: if this proposal was filling a "knowledge wanted"
    // item, resolve that item and link it to the now-approved entry.
    const wantedId = pending.wanted_id != null ? Number(pending.wanted_id) : null;
    if (wantedId != null && entryId != null && (d.decision === "accept" || d.decision === "update")) {
      db.prepare(
        "UPDATE kb_wanted SET status = 'filled', filled_entry_id = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ? AND status != 'dismissed'"
      ).run(entryId, d.decidedBy ?? "auto (proposal approved)", wantedId);
    }

    return { ok: true, entry_id: entryId };
  });

  return tx();
}

// ─── FTS search ────────────────────────────────────────────────────────────

/** Build a safe FTS5 MATCH string: quote each alphanumeric token, OR them together. */
function toMatchQuery(query: string): string {
  const tokens = (query.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

export interface FtsHit {
  id: number;
  type: "knowledge" | "profile";
  title: string;
  snippet: string;
  status: string;
  tags: string[];
  systems: string[];
  ftsScore: number; // higher = better (already negated from bm25)
}

export function searchFTS(query: string, opts: { type?: "all" | "knowledge" | "profile"; limit?: number } = {}): FtsHit[] {
  const db = getDb();
  const type = opts.type ?? "all";
  const limit = opts.limit ?? 24;
  const match = toMatchQuery(query);
  if (!match) return [];
  const hits: FtsHit[] = [];

  if (type === "all" || type === "knowledge") {
    try {
      const rows = db.prepare(`
        SELECT e.id AS id, e.title AS title, e.body AS body, e.status AS status,
               e.tags AS tags, e.systems AS systems, bm25(knowledge_fts) AS score
        FROM knowledge_fts JOIN knowledge_entries e ON e.id = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ? AND e.status IN ('approved','pending')
        ORDER BY score LIMIT ?
      `).all(match, limit) as Record<string, unknown>[];
      for (const r of rows) {
        hits.push({
          id: Number(r.id),
          type: "knowledge",
          title: String(r.title ?? ""),
          snippet: makeSnippet(String(r.body ?? "")),
          status: String(r.status ?? ""),
          tags: parseArr(r.tags),
          systems: parseArr(r.systems),
          ftsScore: -Number(r.score),
        });
      }
    } catch { /* malformed match — ignore */ }
  }

  if (type === "all" || type === "profile") {
    try {
      const rows = db.prepare(`
        SELECT p.id AS id, p.name AS name, p.summary AS summary, bm25(profiles_fts) AS score
        FROM profiles_fts JOIN people_profiles p ON p.id = profiles_fts.rowid
        WHERE profiles_fts MATCH ? ORDER BY score LIMIT ?
      `).all(match, limit) as Record<string, unknown>[];
      for (const r of rows) {
        hits.push({
          id: Number(r.id),
          type: "profile",
          title: String(r.name ?? ""),
          snippet: makeSnippet(String(r.summary ?? "")),
          status: "approved",
          tags: [],
          systems: [],
          ftsScore: -Number(r.score),
        });
      }
    } catch { /* ignore */ }
  }

  return hits;
}

export function makeSnippet(text: string, max = 240): string {
  // Strip a leading YAML frontmatter block — entries seeded from memory files begin
  // with `---\n…\n---`, which otherwise fills the snippet (and surfaced hints) with
  // "name:/description:/type:" noise instead of the actual knowledge.
  const stripped = text.replace(/^﻿?\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const clean = (stripped.trim() ? stripped : text).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

// ─── Profiles ─────────────────────────────────────────────────────────────

/** Upsert a profile (auto-applied, no approval). Appends a fact if provided. */
export function upsertProfile(input: ProfileInput): Record<string, unknown> {
  const db = getDb();
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM people_profiles WHERE name = ?").get(input.name) as Record<string, unknown> | undefined;

    let facts: unknown[] = [];
    if (existing) { try { facts = JSON.parse(String(existing.facts ?? "[]")); } catch { facts = []; } }
    if (input.addFact) {
      facts.push({
        fact: input.addFact.fact,
        source: input.addFact.source ?? "",
        at: new Date().toISOString(),
        by: input.addFact.by ?? input.by ?? "",
      });
    }

    let id: number;
    let name: string;
    let summary: string;

    if (existing) {
      id = Number(existing.id);
      name = input.name;
      summary = input.summary ?? String(existing.summary ?? "");
      db.prepare(`
        UPDATE people_profiles
        SET aliases = ?, role = ?, org = ?, relationships = ?, summary = ?, facts = ?,
            updated_at = datetime('now'), updated_by = ?, embed_stale = 1
        WHERE id = ?
      `).run(
        JSON.stringify(input.aliases ?? parseArr(existing.aliases)),
        input.role ?? String(existing.role ?? ""),
        input.org ?? String(existing.org ?? ""),
        input.relationships ?? String(existing.relationships ?? ""),
        summary, JSON.stringify(facts), input.by ?? null, id
      );
    } else {
      summary = input.summary ?? "";
      name = input.name;
      const res = db.prepare(`
        INSERT INTO people_profiles (name, aliases, role, org, relationships, summary, facts, updated_by, embed_stale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        name, JSON.stringify(input.aliases ?? []), input.role ?? "", input.org ?? "",
        input.relationships ?? "", summary, JSON.stringify(facts), input.by ?? null
      );
      id = Number(res.lastInsertRowid);
    }

    syncProfileFts(id, name, summary, facts);
    return db.prepare("SELECT * FROM people_profiles WHERE id = ?").get(id) as Record<string, unknown>;
  });

  return mapProfile(tx())!;
}

export function getProfile(name: string): Record<string, unknown> | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM people_profiles WHERE name = ? COLLATE NOCASE").get(name) as Record<string, unknown> | undefined;
  return mapProfile(row);
}

export function listProfiles(): Record<string, unknown>[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM people_profiles ORDER BY name ASC").all() as Record<string, unknown>[];
  return rows.map((r) => mapProfile(r)!);
}

// ─── Embedding maintenance ───────────────────────────────────────────────

export function markEntryEmbedding(id: number, buffer: Buffer): void {
  getDb().prepare("UPDATE knowledge_entries SET embedding = ?, embed_stale = 0 WHERE id = ?").run(buffer, id);
}

export function markProfileEmbedding(id: number, buffer: Buffer): void {
  getDb().prepare("UPDATE people_profiles SET embedding = ?, embed_stale = 0 WHERE id = ?").run(buffer, id);
}

export function staleEntries(limit = 32): Record<string, unknown>[] {
  return getDb().prepare(
    "SELECT id, title, body, tags, systems FROM knowledge_entries WHERE embed_stale = 1 LIMIT ?"
  ).all(limit) as Record<string, unknown>[];
}

export function staleProfiles(limit = 32): Record<string, unknown>[] {
  return getDb().prepare(
    "SELECT id, name, summary, role, org, facts FROM people_profiles WHERE embed_stale = 1 LIMIT ?"
  ).all(limit) as Record<string, unknown>[];
}

// ─── Seed helpers ────────────────────────────────────────────────────────

/** Insert an already-approved entry (used by the seeder). Returns the new id. */
export function insertApprovedEntry(input: {
  title: string; body: string; source?: string; category?: string; tags?: string[]; systems?: string[]; agent?: string; reviewFlag?: boolean;
}): number {
  const db = getDb();
  const tags = input.tags ?? [];
  const systems = input.systems ?? [];
  const keywords = keywordsFor(input.title, tags, systems);
  const tx = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO knowledge_entries (title, body, category, tags, keywords, systems, source, status, created_by_agent, embed_stale)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1)
    `).run(
      input.title, input.body, input.category ?? "", JSON.stringify(tags), keywords,
      JSON.stringify(systems), input.source ?? "", input.agent ?? "seed"
    );
    const id = Number(res.lastInsertRowid);
    syncEntryFts(id, input.title, input.body, keywords, tags);
    return id;
  });
  return tx();
}

export function countEntries(): number {
  return Number((getDb().prepare("SELECT COUNT(*) AS c FROM knowledge_entries").get() as { c: number }).c);
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export function stats(): Record<string, unknown> {
  const db = getDb();
  const byStatus = db.prepare("SELECT status, COUNT(*) AS c FROM knowledge_entries GROUP BY status").all() as { status: string; c: number }[];
  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const r of byStatus) { statusMap[r.status] = r.c; total += r.c; }
  const pendingQueue = Number((db.prepare("SELECT COUNT(*) AS c FROM knowledge_pending WHERE status = 'pending'").get() as { c: number }).c);
  const flagged = Number((db.prepare("SELECT COUNT(*) AS c FROM knowledge_pending WHERE status = 'pending' AND review_flag = 1").get() as { c: number }).c);
  const profiles = Number((db.prepare("SELECT COUNT(*) AS c FROM people_profiles").get() as { c: number }).c);
  const staleE = Number((db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE embed_stale = 1").get() as { c: number }).c);
  const staleP = Number((db.prepare("SELECT COUNT(*) AS c FROM people_profiles WHERE embed_stale = 1").get() as { c: number }).c);
  // Compact 7-day usage pulse for the stats header (full breakdown lives in accessAnalytics).
  const pulse = db.prepare(`
    SELECT
      SUM(CASE WHEN action='search' THEN 1 ELSE 0 END) AS searches,
      SUM(CASE WHEN action='search' AND hit=1 THEN 1 ELSE 0 END) AS hits,
      COUNT(*) AS accesses
    FROM kb_access_log WHERE ts >= datetime('now','-7 days')
  `).get() as { searches: number | null; hits: number | null; accesses: number | null };
  const searches7d = Number(pulse.searches ?? 0);
  return {
    entries: {
      total,
      approved: statusMap["approved"] ?? 0,
      pending: statusMap["pending"] ?? 0,
      rejected: statusMap["rejected"] ?? 0,
      superseded: statusMap["superseded"] ?? 0,
    },
    pending_queue: pendingQueue,
    flagged_for_review: flagged,
    profiles,
    stale_entries: staleE,
    stale_profiles: staleP,
    usage_7d: {
      accesses: Number(pulse.accesses ?? 0),
      searches: searches7d,
      hit_rate: searches7d ? Number((Number(pulse.hits ?? 0) / searches7d).toFixed(3)) : null,
    },
  };
}

// ─── Access audit ────────────────────────────────────────────────────────────

export interface AccessLogInput {
  action: "search" | "view" | "related" | "propose" | "surface" | "inline";
  agent?: string | null;
  query?: string | null;
  type_filter?: string | null;
  result_count?: number | null;
  top_score?: number | null;
  hit?: boolean | null;
  result_ids?: number[] | null;
  entry_id?: number | null;
  latency_ms?: number | null;
  embeddings_ready?: boolean | null;
}

/** Record one KB access. Best-effort: any failure is swallowed so it never breaks a request. */
export function logAccess(a: AccessLogInput): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO kb_access_log
        (action, agent, query, type_filter, result_count, top_score, hit, result_ids, entry_id, latency_ms, embeddings_ready)
      VALUES
        (@action, @agent, @query, @type_filter, @result_count, @top_score, @hit, @result_ids, @entry_id, @latency_ms, @embeddings_ready)
    `).run({
      action: a.action,
      agent: a.agent ?? null,
      query: a.query ?? null,
      type_filter: a.type_filter ?? null,
      result_count: a.result_count ?? null,
      top_score: a.top_score ?? null,
      hit: a.hit == null ? null : a.hit ? 1 : 0,
      result_ids: a.result_ids && a.result_ids.length ? JSON.stringify(a.result_ids) : null,
      entry_id: a.entry_id ?? null,
      latency_ms: a.latency_ms ?? null,
      embeddings_ready: a.embeddings_ready == null ? null : a.embeddings_ready ? 1 : 0,
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "KB access log insert failed");
  }
}

// ─── Knowledge wanted (misses → actionable backlog) ─────────────────────────

/**
 * Record a knowledge gap as a deduped "knowledge wanted" item. Best-effort.
 * Fires automatically on a zero-result search, and explicitly via POST /api/kb/wanted
 * when an agent got results but they didn't answer the question (pass a note).
 * Returns the wanted item's id (so the caller can link a proposal to it), or null.
 */
export function recordWanted(query: string, agent: string | null, note?: string | null): number | null {
  const q = (query || "").trim();
  const norm = q.toLowerCase();
  // Skip trivial/gibberish: need a real word and some length.
  if (norm.length < 8 || !/[a-z]{3,}/.test(norm)) return null;
  try {
    const db = getDb();
    const existing = db.prepare("SELECT id, agents FROM kb_wanted WHERE norm_query = ?").get(norm) as
      { id: number; agents: string } | undefined;
    if (existing) {
      let agents: string[] = [];
      try { agents = JSON.parse(existing.agents) as string[]; } catch { agents = []; }
      if (agent && !agents.includes(agent)) agents.push(agent);
      db.prepare(
        "UPDATE kb_wanted SET times = times + 1, query = ?, agents = ?, last_seen = datetime('now'), " +
        "note = COALESCE(?, note), " +
        "status = CASE WHEN status = 'dismissed' THEN 'dismissed' ELSE 'open' END WHERE id = ?"
      ).run(q, JSON.stringify(agents.slice(0, 20)), note ?? null, existing.id);
      return existing.id;
    }
    const res = db.prepare("INSERT INTO kb_wanted (norm_query, query, agents, note) VALUES (?, ?, ?, ?)")
      .run(norm, q, JSON.stringify(agent ? [agent] : []), note ?? null);
    return Number(res.lastInsertRowid);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "KB recordWanted failed");
    return null;
  }
}

export function listWanted(status = "open"): Record<string, unknown>[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM kb_wanted WHERE status = ? ORDER BY times DESC, last_seen DESC LIMIT 100"
  ).all(status) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, agents: JSON.parse((r.agents as string) || "[]") }));
}

export function decideWanted(id: number, status: "filled" | "dismissed" | "open", by?: string, filledEntryId?: number | null): boolean {
  try {
    const db = getDb();
    const res = db.prepare(
      "UPDATE kb_wanted SET status = ?, decided_at = datetime('now'), decided_by = ?, filled_entry_id = ? WHERE id = ?"
    ).run(status, by ?? null, filledEntryId ?? null, id);
    return res.changes > 0;
  } catch {
    return false;
  }
}

/** Aggregate usage + effectiveness metrics over the last `days` days. */
export function accessAnalytics(days = 30): Record<string, unknown> {
  const db = getDb();
  const win = Math.max(1, Math.min(days, 365));
  const since = `-${win} days`;

  const byAction = db.prepare(
    "SELECT action, COUNT(*) c FROM kb_access_log WHERE ts >= datetime('now', ?) GROUP BY action"
  ).all(since) as { action: string; c: number }[];
  const windowTotals: Record<string, number> = { search: 0, view: 0, related: 0, propose: 0, surface: 0, inline: 0 };
  for (const r of byAction) windowTotals[r.action] = r.c;

  const allTime = db.prepare("SELECT action, COUNT(*) c FROM kb_access_log GROUP BY action").all() as { action: string; c: number }[];
  const allTimeTotals: Record<string, number> = { search: 0, view: 0, related: 0, propose: 0, surface: 0, inline: 0 };
  for (const r of allTime) allTimeTotals[r.action] = r.c;

  // Daily time series (one row per day, counts per action).
  const rawSeries = db.prepare(
    "SELECT date(ts) d, action, COUNT(*) c FROM kb_access_log WHERE ts >= datetime('now', ?) GROUP BY date(ts), action ORDER BY d"
  ).all(since) as { d: string; action: string; c: number }[];
  const seriesMap = new Map<string, { date: string; search: number; view: number; related: number; propose: number }>();
  for (const r of rawSeries) {
    let day = seriesMap.get(r.d);
    if (!day) { day = { date: r.d, search: 0, view: 0, related: 0, propose: 0 }; seriesMap.set(r.d, day); }
    if (r.action in day) (day as Record<string, number | string>)[r.action] = r.c;
  }
  const timeseries = [...seriesMap.values()];

  const searchAgg = db.prepare(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) hits,
            SUM(CASE WHEN hit=0 THEN 1 ELSE 0 END) misses,
            ROUND(AVG(latency_ms),1) avg_latency_ms
     FROM kb_access_log WHERE action='search' AND ts >= datetime('now', ?)`
  ).get(since) as { total: number; hits: number | null; misses: number | null; avg_latency_ms: number | null };
  const total = searchAgg.total || 0;

  // GAPS — search terms that returned nothing (grouped, case-insensitive). The primary "what to write next" signal.
  const gaps = db.prepare(
    `SELECT query, COUNT(*) times, MAX(ts) last_at
     FROM kb_access_log
     WHERE action='search' AND hit=0 AND query IS NOT NULL AND ts >= datetime('now', ?)
     GROUP BY lower(trim(query)) ORDER BY times DESC, last_at DESC LIMIT 30`
  ).all(since) as unknown[];

  // WEAK — searches that "hit" but only marginally (top raw cosine below a good-match bar):
  // the topic is under-served and worth strengthening. top_score here is the raw cosine.
  const weakBar = Number.parseFloat(process.env.KB_WEAK_MAX_SIM || "0.68");
  const weak = db.prepare(
    `SELECT query, COUNT(*) times, ROUND(AVG(top_score),3) avg_top_score, MAX(ts) last_at
     FROM kb_access_log
     WHERE action='search' AND hit=1 AND top_score IS NOT NULL AND top_score < ? AND ts >= datetime('now', ?)
     GROUP BY lower(trim(query)) ORDER BY times DESC, last_at DESC LIMIT 30`
  ).all(weakBar, since) as unknown[];

  const topQueries = db.prepare(
    `SELECT query, COUNT(*) times,
            SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) hits, MAX(ts) last_at
     FROM kb_access_log
     WHERE action='search' AND query IS NOT NULL AND ts >= datetime('now', ?)
     GROUP BY lower(trim(query)) ORDER BY times DESC, last_at DESC LIMIT 30`
  ).all(since) as unknown[];

  const topEntries = db.prepare(
    `SELECT a.entry_id, e.title, e.status, COUNT(*) views, MAX(a.ts) last_at
     FROM kb_access_log a LEFT JOIN knowledge_entries e ON e.id = a.entry_id
     WHERE a.action IN ('view','related') AND a.entry_id IS NOT NULL AND a.ts >= datetime('now', ?)
     GROUP BY a.entry_id ORDER BY views DESC, last_at DESC LIMIT 25`
  ).all(since) as unknown[];

  const byAgent = db.prepare(
    `SELECT COALESCE(agent,'(unknown)') agent,
            SUM(CASE WHEN action='search' THEN 1 ELSE 0 END) searches,
            SUM(CASE WHEN action='view' THEN 1 ELSE 0 END) views,
            SUM(CASE WHEN action='related' THEN 1 ELSE 0 END) related,
            SUM(CASE WHEN action='propose' THEN 1 ELSE 0 END) proposals,
            COUNT(*) total, MAX(ts) last_at
     FROM kb_access_log WHERE ts >= datetime('now', ?)
     GROUP BY COALESCE(agent,'(unknown)') ORDER BY total DESC LIMIT 50`
  ).all(since) as unknown[];

  // Dead weight — approved entries never opened (all-time), candidates to improve or retire.
  const neverAccessed = db.prepare(
    `SELECT COUNT(*) c FROM knowledge_entries e
     WHERE e.status='approved' AND e.hit_count = 0
       AND NOT EXISTS (SELECT 1 FROM kb_access_log a WHERE a.entry_id = e.id AND a.action IN ('view','related'))`
  ).get() as { c: number };
  const neverAccessedSample = db.prepare(
    `SELECT e.id, e.title, e.created_at FROM knowledge_entries e
     WHERE e.status='approved' AND e.hit_count = 0
       AND NOT EXISTS (SELECT 1 FROM kb_access_log a WHERE a.entry_id = e.id AND a.action IN ('view','related'))
     ORDER BY e.created_at ASC LIMIT 20`
  ).all() as unknown[];

  // Surface→open conversion: for each (agent, entry) we auto-surfaced in the window,
  // did that agent then open it (view/related) at or after it was surfaced? This is the
  // real proof that proactive retrieval is landing. result_ids is a JSON array → json_each.
  const surfacing = db.prepare(
    `WITH surfaced AS (
       SELECT a.agent AS agent, CAST(j.value AS INTEGER) AS entry_id, MIN(a.ts) AS first_ts
       FROM kb_access_log a, json_each(a.result_ids) j
       WHERE a.action='surface' AND a.result_ids IS NOT NULL AND a.ts >= datetime('now', ?)
       GROUP BY a.agent, entry_id
     )
     SELECT
       (SELECT COUNT(*) FROM kb_access_log WHERE action='surface' AND ts >= datetime('now', ?)) AS surfaces,
       (SELECT COUNT(*) FROM surfaced) AS entries_surfaced,
       (SELECT COUNT(*) FROM surfaced s
          WHERE EXISTS (
            SELECT 1 FROM kb_access_log v
            WHERE v.action IN ('view','related') AND v.agent = s.agent
              AND v.entry_id = s.entry_id AND v.ts >= s.first_ts
          )) AS entries_opened`
  ).get(since, since) as { surfaces: number; entries_surfaced: number; entries_opened: number };
  const openRate = surfacing.entries_surfaced
    ? Number((surfacing.entries_opened / surfacing.entries_surfaced).toFixed(3))
    : null;

  const first = db.prepare("SELECT MIN(ts) t FROM kb_access_log").get() as { t: string | null };

  const wantedOpen = Number((db.prepare("SELECT COUNT(*) c FROM kb_wanted WHERE status='open'").get() as { c: number }).c);
  const wantedTop = db.prepare(
    "SELECT id, query, times, last_seen FROM kb_wanted WHERE status='open' ORDER BY times DESC, last_seen DESC LIMIT 10"
  ).all() as unknown[];

  // UPTAKE vs WORK VOLUME — the honest measure of whether the hub is actually used per
  // unit of work, not vanity absolute counts. Denominator = tasks (user-instruction
  // messages) and substantive outputs (text updates) in the window. Targets encode the
  // "good uptake" bar (rules say several searches per non-trivial task).
  const work = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM messages WHERE (source='user' OR source IS NULL) AND created_at >= datetime('now', ?)) tasks,
       (SELECT COUNT(*) FROM updates WHERE type='text' AND timestamp >= datetime('now', ?)) outputs`
  ).get(since, since) as { tasks: number; outputs: number };
  const ratio = (n: number, d: number) => (d > 0 ? Number((n / d).toFixed(2)) : 0);
  const uptake = {
    tasks: work.tasks || 0,
    substantive_outputs: work.outputs || 0,
    searches_per_task: ratio(windowTotals.search || 0, work.tasks || 0),
    proposals_per_task: ratio(windowTotals.propose || 0, work.tasks || 0),
    // Knowledge PUSHED into task deliveries (entry bodies inlined by buildKnowledgeHint).
    // This is the push side of the context library: how much relevant knowledge actually
    // reached an agent's context without it having to go looking.
    delivered_per_task: ratio(windowTotals.inline || 0, work.tasks || 0),
    searches_per_output: ratio(windowTotals.search || 0, work.outputs || 0),
    surface_open_rate: openRate,
    // surface_open_rate is deliberately NOT a target any more. Since we inline entry bodies
    // straight into task deliveries, an agent rarely needs to open anything — a low open rate
    // is now the EXPECTED outcome of the push model, not a failure. The honest uptake dials
    // are the two agent-initiated ratios above; open rate is kept only as an observation.
    targets: { searches_per_task: 2, proposals_per_task: 0.3 },
  };

  return {
    days: win,
    logging_since: first.t,
    uptake,
    knowledge_wanted: { open: wantedOpen, top: wantedTop },
    surfacing: {
      surfaces: surfacing.surfaces || 0,
      entries_surfaced: surfacing.entries_surfaced || 0,
      entries_opened: surfacing.entries_opened || 0,
      open_rate: openRate,
    },
    window_totals: windowTotals,
    all_time_totals: allTimeTotals,
    timeseries,
    search: {
      total,
      hits: Number(searchAgg.hits ?? 0),
      misses: Number(searchAgg.misses ?? 0),
      hit_rate: total ? Number((Number(searchAgg.hits ?? 0) / total).toFixed(3)) : null,
      avg_latency_ms: searchAgg.avg_latency_ms ?? null,
    },
    gaps,
    weak,
    top_queries: topQueries,
    top_entries: topEntries,
    by_agent: byAgent,
    never_accessed: { count: neverAccessed.c, sample: neverAccessedSample },
  };
}
