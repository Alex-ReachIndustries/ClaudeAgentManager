// Nested category tree + semantic auto-classification for the Knowledge Hub.
//
// Categories form an arbitrarily deep tree (kb_categories.parent_id). Articles are
// linked many-to-many via kb_entry_categories and may attach at ANY depth. Auto
// classification is bidirectional and semantic:
//   - classifyEntry():    a (re)embedded/approved entry is filed into every category
//                         whose embedding is cosine ≥ threshold (top-N by score).
//   - classifyCategory(): a new/changed category pulls in every approved entry that
//                         matches it.
// Human overrides always win and STICK: a manual pin (source='manual') is never
// removed by auto, and a manual removal of an auto row leaves a suppressed=1
// tombstone so auto classification can never re-add it.
import { getDb } from "../db.js";
import { embed, cosine, vectorToBuffer, bufferToVector } from "./embeddings.js";
import { mapEntry, makeSnippet } from "./store.js";
import { logger } from "../logger.js";

// ─── Tunables (env-overridable) ───────────────────────────────────────────

function threshold(): number {
  const v = Number(process.env.KB_CAT_THRESHOLD);
  return Number.isFinite(v) && v > 0 ? v : 0.42;
}
function maxPer(): number {
  const v = parseInt(process.env.KB_CAT_MAXPER ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  description: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export interface Membership {
  id: number;          // category id
  name: string;
  path: string;        // breadcrumb, e.g. "Systems / Agent Manager"
  source: string;      // 'auto' | 'manual'
  score: number | null;
}

export interface TreeNode extends CategoryRow {
  direct_count: number;      // approved entries pinned directly here
  descendant_count: number;  // direct + all descendants (loose sum)
  children: TreeNode[];
}

// ─── Small helpers ────────────────────────────────────────────────────────

function safeArr(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}

function entryText(row: Record<string, unknown>): string {
  const tags = safeArr(row.tags);
  const systems = safeArr(row.systems);
  return [String(row.title ?? ""), String(row.body ?? ""), tags.join(" "), systems.join(" ")]
    .filter(Boolean).join("\n").slice(0, 8000);
}

/** Ancestor names (root → immediate parent) for a category. */
function ancestorNames(parentId: number | null): string[] {
  const db = getDb();
  const names: string[] = [];
  const seen = new Set<number>();
  let cur = parentId;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const r = db.prepare("SELECT name, parent_id FROM kb_categories WHERE id = ?").get(cur) as
      { name: string; parent_id: number | null } | undefined;
    if (!r) break;
    names.unshift(r.name);
    cur = r.parent_id;
  }
  return names;
}

/** Embedding text for a category: name + ancestor names + description. */
export function catText(cat: { name: string; parent_id: number | null; description?: string | null }): string {
  const ancestors = ancestorNames(cat.parent_id ?? null);
  return [cat.name, ancestors.join(" "), String(cat.description ?? "")]
    .filter(Boolean).join("\n").slice(0, 8000);
}

/** Breadcrumb path string for a category id, using a preloaded id→row map. */
function pathString(id: number, byId: Map<number, { name: string; parent_id: number | null }>): string {
  const parts: string[] = [];
  const seen = new Set<number>();
  let cur: number | null = id;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const r = byId.get(cur);
    if (!r) break;
    parts.unshift(r.name);
    cur = r.parent_id;
  }
  return parts.join(" / ");
}

function categoryMap(): Map<number, { name: string; parent_id: number | null }> {
  const rows = getDb().prepare("SELECT id, name, parent_id FROM kb_categories").all() as
    { id: number; name: string; parent_id: number | null }[];
  return new Map(rows.map((r) => [r.id, { name: r.name, parent_id: r.parent_id }]));
}

/** All descendant category ids of catId (exclusive of catId). */
function descendantIds(catId: number): number[] {
  const rows = getDb().prepare("SELECT id, parent_id FROM kb_categories").all() as
    { id: number; parent_id: number | null }[];
  const childrenOf = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parent_id == null) continue;
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id)!.push(r.id);
  }
  const out: number[] = [];
  const stack = [...(childrenOf.get(catId) ?? [])];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

// ─── Category CRUD ──────────────────────────────────────────────────────

export function listCategories(): CategoryRow[] {
  return getDb().prepare(
    "SELECT id, name, parent_id, description, sort_order, created_by, created_at FROM kb_categories ORDER BY sort_order ASC, name ASC"
  ).all() as CategoryRow[];
}

export function getCategory(id: number): CategoryRow | undefined {
  return getDb().prepare(
    "SELECT id, name, parent_id, description, sort_order, created_by, created_at FROM kb_categories WHERE id = ?"
  ).get(id) as CategoryRow | undefined;
}

export function createCategory(input: {
  name: string; parent_id?: number | null; description?: string; sort_order?: number; created_by?: string;
}): CategoryRow {
  const db = getDb();
  const res = db.prepare(`
    INSERT INTO kb_categories (name, parent_id, description, sort_order, created_by, embed_stale)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    input.name, input.parent_id ?? null, input.description ?? "",
    input.sort_order ?? 0, input.created_by ?? null
  );
  return getCategory(Number(res.lastInsertRowid))!;
}

export function updateCategory(id: number, patch: {
  name?: string; parent_id?: number | null; description?: string; sort_order?: number;
}): CategoryRow | undefined {
  const db = getDb();
  const cur = getCategory(id);
  if (!cur) return undefined;
  const name = patch.name ?? cur.name;
  const parent_id = patch.parent_id !== undefined ? patch.parent_id : cur.parent_id;
  const description = patch.description ?? cur.description;
  const sort_order = patch.sort_order ?? cur.sort_order;
  // Re-embed (and thus re-classify) only if the semantic text changed.
  const reembed = (patch.name !== undefined && patch.name !== cur.name)
    || (patch.description !== undefined && patch.description !== cur.description)
    || (patch.parent_id !== undefined && patch.parent_id !== cur.parent_id);
  db.prepare(`
    UPDATE kb_categories SET name = ?, parent_id = ?, description = ?, sort_order = ?,
      embed_stale = CASE WHEN ? = 1 THEN 1 ELSE embed_stale END
    WHERE id = ?
  `).run(name, parent_id, description, sort_order, reembed ? 1 : 0, id);
  return getCategory(id);
}

/** Delete a category: reparent its children to its parent, then delete. Membership
 *  rows for this category cascade-delete via FK. */
export function deleteCategory(id: number): boolean {
  const db = getDb();
  const cur = getCategory(id);
  if (!cur) return false;
  const tx = db.transaction(() => {
    db.prepare("UPDATE kb_categories SET parent_id = ? WHERE parent_id = ?").run(cur.parent_id, id);
    db.prepare("DELETE FROM kb_categories WHERE id = ?").run(id);
  });
  tx();
  return true;
}

// ─── Embedding maintenance (used by the background embedder) ──────────────

export function markCategoryEmbedding(id: number, buffer: Buffer): void {
  getDb().prepare("UPDATE kb_categories SET embedding = ?, embed_stale = 0 WHERE id = ?").run(buffer, id);
}

export function staleCategories(limit = 32): Record<string, unknown>[] {
  return getDb().prepare(
    "SELECT id, name, parent_id, description FROM kb_categories WHERE embed_stale = 1 LIMIT ?"
  ).all(limit) as Record<string, unknown>[];
}

// ─── Membership queries ───────────────────────────────────────────────────

/** Active (non-suppressed) category memberships for an entry, with breadcrumbs. */
export function membershipsForEntry(entryId: number): Membership[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id AS id, c.name AS name, ec.source AS source, ec.score AS score
    FROM kb_entry_categories ec JOIN kb_categories c ON c.id = ec.category_id
    WHERE ec.entry_id = ? AND ec.suppressed = 0
    ORDER BY ec.score DESC NULLS LAST, c.name ASC
  `).all(entryId) as { id: number; name: string; source: string; score: number | null }[];
  if (rows.length === 0) return [];
  const byId = categoryMap();
  return rows.map((r) => ({
    id: r.id, name: r.name, path: pathString(r.id, byId), source: r.source, score: r.score,
  }));
}

/** Attach memberships to a mapped entry object (id+name+path breadcrumb). */
export function withMemberships(entry: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!entry) return entry;
  return { ...entry, categories: membershipsForEntry(Number(entry.id)) };
}

// ─── Auto-classification ──────────────────────────────────────────────────

/**
 * File an approved entry into every category it semantically matches.
 * Top-N by cosine ≥ threshold. Respects overrides: never touches manual rows or
 * suppressed tombstones; removes only stale auto rows that no longer qualify.
 * Returns the number of active auto memberships after the pass.
 */
export async function classifyEntry(entryId: number): Promise<number> {
  const db = getDb();
  const entry = db.prepare(
    "SELECT id, title, body, tags, systems, status, embedding FROM knowledge_entries WHERE id = ?"
  ).get(entryId) as Record<string, unknown> | undefined;
  if (!entry || String(entry.status) !== "approved") return 0;

  let vec: Float32Array;
  if (entry.embedding) vec = bufferToVector(entry.embedding as Buffer);
  else {
    try { vec = await embed(entryText(entry), false); } catch { return 0; }
  }

  const cats = db.prepare("SELECT id, embedding FROM kb_categories WHERE embedding IS NOT NULL").all() as
    { id: number; embedding: Buffer }[];
  const th = threshold();
  const scored = cats
    .map((c) => ({ id: c.id, sim: cosine(vec, bufferToVector(c.embedding)) }))
    .filter((c) => c.sim >= th)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, maxPer());
  const topIds = new Set(scored.map((t) => t.id));

  const tx = db.transaction(() => {
    const existing = db.prepare(
      "SELECT category_id, source, suppressed FROM kb_entry_categories WHERE entry_id = ?"
    ).all(entryId) as { category_id: number; source: string; suppressed: number }[];
    const byCat = new Map(existing.map((r) => [r.category_id, r]));

    for (const t of scored) {
      const ex = byCat.get(t.id);
      if (ex) {
        if (ex.suppressed === 1 || ex.source === "manual") continue; // override — leave it
        db.prepare("UPDATE kb_entry_categories SET source='auto', suppressed=0, score=? WHERE entry_id=? AND category_id=?")
          .run(t.sim, entryId, t.id);
      } else {
        db.prepare("INSERT INTO kb_entry_categories (entry_id, category_id, source, suppressed, score) VALUES (?, ?, 'auto', 0, ?)")
          .run(entryId, t.id, t.sim);
      }
    }
    // Drop auto rows that no longer qualify — but never manual rows or tombstones.
    for (const r of existing) {
      if (r.source === "auto" && r.suppressed === 0 && !topIds.has(r.category_id)) {
        db.prepare("DELETE FROM kb_entry_categories WHERE entry_id=? AND category_id=?").run(entryId, r.category_id);
      }
    }
  });
  tx();
  return scored.length;
}

/**
 * Pull every matching approved entry into a (new/changed) category. Attaches
 * qualifying entries as auto, respecting existing manual/suppressed rows.
 * Returns the number of newly-added memberships.
 */
export async function classifyCategory(categoryId: number): Promise<number> {
  const db = getDb();
  const cat = db.prepare("SELECT id, embedding FROM kb_categories WHERE id = ?").get(categoryId) as
    { id: number; embedding: Buffer | null } | undefined;
  if (!cat || !cat.embedding) return 0;
  const cvec = bufferToVector(cat.embedding);
  const th = threshold();

  const entries = db.prepare(
    "SELECT id, embedding FROM knowledge_entries WHERE status='approved' AND embedding IS NOT NULL"
  ).all() as { id: number; embedding: Buffer }[];

  const tx = db.transaction(() => {
    let added = 0;
    for (const e of entries) {
      const sim = cosine(cvec, bufferToVector(e.embedding));
      if (sim < th) continue;
      const ex = db.prepare("SELECT source, suppressed FROM kb_entry_categories WHERE entry_id=? AND category_id=?")
        .get(e.id, categoryId) as { source: string; suppressed: number } | undefined;
      if (ex) {
        if (ex.suppressed === 1 || ex.source === "manual") continue;
        db.prepare("UPDATE kb_entry_categories SET source='auto', suppressed=0, score=? WHERE entry_id=? AND category_id=?")
          .run(sim, e.id, categoryId);
      } else {
        db.prepare("INSERT INTO kb_entry_categories (entry_id, category_id, source, suppressed, score) VALUES (?, ?, 'auto', 0, ?)")
          .run(e.id, categoryId, sim);
        added++;
      }
    }
    return added;
  });
  return tx();
}

// ─── Manual membership overrides ────────────────────────────────────────

/** Manual pin (source='manual', suppressed=0). Auto classification will never remove it. */
export function addMembership(entryId: number, categoryId: number): void {
  getDb().prepare(`
    INSERT INTO kb_entry_categories (entry_id, category_id, source, suppressed, score)
    VALUES (?, ?, 'manual', 0, NULL)
    ON CONFLICT(entry_id, category_id) DO UPDATE SET source='manual', suppressed=0
  `).run(entryId, categoryId);
}

/**
 * Manual remove. If the row is auto → set suppressed=1 (tombstone so auto can't
 * re-add). If manual → delete. If no row exists → leave a suppressed tombstone so
 * a future auto pass can't add it.
 */
export function removeMembership(entryId: number, categoryId: number): void {
  const db = getDb();
  const row = db.prepare("SELECT source FROM kb_entry_categories WHERE entry_id=? AND category_id=?")
    .get(entryId, categoryId) as { source: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO kb_entry_categories (entry_id, category_id, source, suppressed, score) VALUES (?, ?, 'auto', 1, NULL)")
      .run(entryId, categoryId);
  } else if (row.source === "manual") {
    db.prepare("DELETE FROM kb_entry_categories WHERE entry_id=? AND category_id=?").run(entryId, categoryId);
  } else {
    db.prepare("UPDATE kb_entry_categories SET suppressed=1 WHERE entry_id=? AND category_id=?").run(entryId, categoryId);
  }
}

// ─── Tree + browsing ────────────────────────────────────────────────────

export function buildTree(): TreeNode[] {
  const db = getDb();
  const cats = db.prepare(
    "SELECT id, name, parent_id, description, sort_order, created_by, created_at FROM kb_categories ORDER BY sort_order ASC, name ASC"
  ).all() as CategoryRow[];

  const countRows = db.prepare(`
    SELECT ec.category_id AS cid, COUNT(DISTINCT ec.entry_id) AS c
    FROM kb_entry_categories ec JOIN knowledge_entries e ON e.id = ec.entry_id
    WHERE ec.suppressed = 0 AND e.status = 'approved'
    GROUP BY ec.category_id
  `).all() as { cid: number; c: number }[];
  const direct = new Map(countRows.map((r) => [r.cid, r.c]));

  const childrenOf = new Map<number | null, CategoryRow[]>();
  for (const c of cats) {
    const key = c.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(c);
  }

  const build = (cat: CategoryRow): TreeNode => {
    const children = (childrenOf.get(cat.id) ?? []).map(build);
    const direct_count = direct.get(cat.id) ?? 0;
    const descendant_count = direct_count + children.reduce((s, k) => s + k.descendant_count, 0);
    return { ...cat, direct_count, descendant_count, children };
  };

  return (childrenOf.get(null) ?? []).map(build);
}

/** Approved entries pinned in a category (optionally including descendants). */
export function entriesInCategory(catId: number, descendants: boolean): Record<string, unknown>[] {
  const db = getDb();
  const ids = descendants ? [catId, ...descendantIds(catId)] : [catId];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT DISTINCT e.* FROM knowledge_entries e
    JOIN kb_entry_categories ec ON ec.entry_id = e.id
    WHERE ec.category_id IN (${placeholders}) AND ec.suppressed = 0 AND e.status = 'approved'
    ORDER BY e.updated_at DESC
  `).all(...ids) as Record<string, unknown>[];
  return rows.map((r) => withMemberships(mapEntry(r))!);
}

/** Related entries: top semantic neighbours ∪ entries sharing a category. */
export async function relatedEntries(entryId: number, limit = 8): Promise<Record<string, unknown>[]> {
  const db = getDb();
  const entry = db.prepare("SELECT id, embedding FROM knowledge_entries WHERE id = ?").get(entryId) as
    { id: number; embedding: Buffer | null } | undefined;
  if (!entry) return [];

  const out = new Map<number, { id: number; title: string; snippet: string; score: number; via: string }>();

  if (entry.embedding) {
    const vec = bufferToVector(entry.embedding);
    const others = db.prepare(
      "SELECT id, title, body, embedding FROM knowledge_entries WHERE status='approved' AND id != ? AND embedding IS NOT NULL"
    ).all(entryId) as { id: number; title: string; body: string; embedding: Buffer }[];
    const scored = others
      .map((o) => ({ id: o.id, title: o.title, body: o.body, sim: cosine(vec, bufferToVector(o.embedding)) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit);
    for (const s of scored) {
      out.set(s.id, { id: s.id, title: s.title, snippet: makeSnippet(s.body), score: Number(s.sim.toFixed(4)), via: "semantic" });
    }
  }

  const shared = db.prepare(`
    SELECT DISTINCT e.id AS id, e.title AS title, e.body AS body FROM knowledge_entries e
    JOIN kb_entry_categories ec ON ec.entry_id = e.id
    WHERE ec.suppressed = 0 AND e.status = 'approved' AND e.id != ?
      AND ec.category_id IN (SELECT category_id FROM kb_entry_categories WHERE entry_id = ? AND suppressed = 0)
  `).all(entryId, entryId) as { id: number; title: string; body: string }[];
  for (const s of shared) {
    if (!out.has(s.id)) out.set(s.id, { id: s.id, title: s.title, snippet: makeSnippet(s.body), score: 0, via: "category" });
  }

  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(limit, out.size));
}

// ─── Bootstrap starter taxonomy ────────────────────────────────────────

interface StarterNode { name: string; description: string; children?: StarterNode[]; }

const STARTER: StarterNode[] = [
  {
    name: "Systems",
    description: "The distinct software systems and platforms we build and operate.",
    children: [
      { name: "AIGroupPortal", description: "The AIGroupPortal web application and its services." },
      { name: "Lumi", description: "The Lumi product and its components." },
      { name: "Agent Manager", description: "The Claude agent manager: dashboard, backend, launcher and agent orchestration." },
      { name: "Android", description: "The Android app / APK client and its native build." },
      { name: "Infra & Docker", description: "Infrastructure, docker-compose services, containers, deployment and disk hygiene." },
      { name: "AWS", description: "AWS resources, CDK, S3, ECS, CloudFormation, IAM and cloud operations." },
    ],
  },
  {
    name: "Working Practices",
    description: "How we work: process, conventions and operational habits.",
    children: [
      { name: "Dashboard & Comms", description: "Posting dashboard updates, messaging, notifications and communication with the operator." },
      { name: "Git & PRs", description: "Git branching, commits, pull requests and code review workflow." },
      { name: "Build & Test", description: "Building, testing, compiling and running code in Docker." },
      { name: "Session & Agent Ops", description: "Session connect/resume, agent lifecycle, launching and permission modes." },
    ],
  },
  { name: "Gotchas & Fixes", description: "Bugs, pitfalls, surprising behaviour and the fixes that resolved them." },
  { name: "People & Orgs", description: "People, teams, organisations, roles and relationships." },
  {
    name: "Tooling",
    description: "Developer tools and utilities we use.",
    children: [
      { name: "PrintingPress", description: "The PrintingPress document generation tool." },
      { name: "Screen Interaction", description: "The screen interaction service and GUI automation in Xephyr." },
      { name: "Browser/CDP", description: "Browser testing via direct Chrome DevTools Protocol." },
      { name: "MCP", description: "Model Context Protocol servers and integrations." },
    ],
  },
];

/**
 * Create the starter taxonomy (only if empty, unless force), embed the categories
 * synchronously so vectors exist, then classify every approved entry into the tree.
 * With force=true on a populated tree, skips creation and just re-embeds any stale
 * categories + re-classifies all approved entries (honouring overrides).
 */
export async function bootstrapTaxonomy(force = false): Promise<{ skipped: boolean; categories_created: number; memberships: number }> {
  const db = getDb();
  const existing = Number((db.prepare("SELECT COUNT(*) AS c FROM kb_categories").get() as { c: number }).c);
  if (existing > 0 && !force) return { skipped: true, categories_created: 0, memberships: 0 };

  let created = 0;
  if (existing === 0) {
    const insert = (node: StarterNode, parentId: number | null, order: number): void => {
      const res = db.prepare(
        "INSERT INTO kb_categories (name, parent_id, description, sort_order, created_by, embed_stale) VALUES (?, ?, ?, ?, 'bootstrap', 1)"
      ).run(node.name, parentId, node.description, order);
      created++;
      const id = Number(res.lastInsertRowid);
      (node.children ?? []).forEach((ch, i) => insert(ch, id, i));
    };
    STARTER.forEach((n, i) => insert(n, null, i));
  }

  // Embed any stale categories synchronously (blocks until model is loaded).
  const stale = db.prepare("SELECT id, name, parent_id, description FROM kb_categories WHERE embed_stale = 1").all() as
    { id: number; name: string; parent_id: number | null; description: string }[];
  for (const c of stale) {
    try {
      const vec = await embed(catText(c), false);
      markCategoryEmbedding(c.id, vectorToBuffer(vec));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), id: c.id }, "KB category embed failed (bootstrap)");
    }
  }

  // Classify every approved entry into the (now-embedded) tree.
  const entries = db.prepare("SELECT id FROM knowledge_entries WHERE status = 'approved'").all() as { id: number }[];
  let memberships = 0;
  for (const e of entries) {
    try { memberships += await classifyEntry(e.id); } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), id: e.id }, "KB classifyEntry failed (bootstrap)");
    }
  }

  logger.info({ created, memberships, force }, "KB taxonomy bootstrap complete");
  return { skipped: false, categories_created: created, memberships };
}
