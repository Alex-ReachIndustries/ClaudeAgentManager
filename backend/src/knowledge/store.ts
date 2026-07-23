// Knowledge Hub data-access layer. Wraps better-sqlite3 with prepared-statement
// helpers and keeps the FTS5 shadow tables (knowledge_fts / profiles_fts) in sync
// on every insert/update/delete. Vectors live in the `embedding` BLOB columns and
// are (re)computed by the background embedder whenever embed_stale = 1.
import { getDb } from "../db.js";
import { bufferToVector } from "./embeddings.js";

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
        (entry_id, kind, proposed_title, proposed_body, proposed_category, proposed_tags, proposed_systems, proposed_source, proposing_agent, rationale, conflict_flags, review_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId, input.kind,
      input.title ?? null, input.body ?? null, input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.systems ? JSON.stringify(input.systems) : null,
      input.source ?? null, input.agent ?? null, input.rationale ?? "",
      conflictsJson, reviewFlag
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
  const clean = text.replace(/\s+/g, " ").trim();
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
  };
}
