// Knowledge Hub HTTP API. Mounted at /api/kb. Global authMiddleware already applies.
// Route ordering matters: the static paths (/search, /pending, /profiles*, /stats,
// /seed) are declared BEFORE the catch-all /:id so they aren't shadowed.
import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";
import { getDb } from "../db.js";
import { hybridSearch } from "../knowledge/search.js";
import { scanConflicts } from "../knowledge/conflict.js";
import { broadcast } from "../sse.js";
import { sendPushToAll } from "../push.js";
import { seedFromMemories } from "../knowledge/seed.js";
import { embeddingsReady, embeddingDim } from "../knowledge/embeddings.js";
import {
  createProposal, getEntry, listPending, getPending, decideProposal,
  upsertProfile, getProfile, listProfiles, stats, countEntries,
  logAccess, accessAnalytics, recordWanted, listWanted, decideWanted,
} from "../knowledge/store.js";
import {
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  buildTree, entriesInCategory, relatedEntries, membershipsForEntry, withMemberships,
  addMembership, removeMembership, classifyEntry, bootstrapTaxonomy,
} from "../knowledge/categories.js";

const router: Router = express.Router();

// Absolute relevance floor: a search counts as a "hit" if it keyword-matched OR its top
// raw vector cosine reached this. Tuned for bge-small-en-v1.5 (related ~0.6-0.8, unrelated
// ~0.3-0.5); override via env if the embedding model changes.
const KB_HIT_MIN_SIM = Number.parseFloat(process.env.KB_HIT_MIN_SIM || "0.55");

// Best-effort attribution of the calling agent for the audit log. Agents pass their
// identity via ?agent= (the /kb command sends $CLAUDE_AGENT_ID) or an X-Agent-Id
// header; unattributed callers (e.g. the dashboard) are logged as NULL / "(unknown)".
// If the value is a known agent session id, resolve it to the friendly title so the
// analytics read as names, not UUIDs.
function callerAgent(req: Request): string | null {
  const raw = String(req.query.agent ?? req.header("x-agent-id") ?? req.header("x-agent") ?? "").trim();
  if (!raw) return null;
  try {
    const row = getDb().prepare("SELECT base_title, title FROM agents WHERE id = ?").get(raw) as
      { base_title?: string; title?: string } | undefined;
    if (row) return (row.base_title || row.title || raw).trim() || raw;
  } catch { /* fall through to raw value */ }
  return raw;
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const proposeSchema = z.object({
  kind: z.enum(["new", "edit"]),
  entry_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(100000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  systems: z.array(z.string().max(100)).max(50).optional(),
  source: z.string().max(1000).optional(),
  agent: z.string().max(200).optional(),
  rationale: z.string().max(4000).optional(),
  category_ids: z.array(z.number().int().positive()).max(50).optional(),
  wanted_id: z.number().int().positive().optional(),   // gap this fills; auto-resolved on approval
}).refine((d) => d.kind === "edit" ? !!d.entry_id : !!d.title, {
  message: "kind 'new' requires title; kind 'edit' requires entry_id",
});

const categoryCreateSchema = z.object({
  name: z.string().min(1).max(200),
  parent_id: z.number().int().positive().nullable().optional(),
  description: z.string().max(4000).optional(),
  sort_order: z.number().int().optional(),
  created_by: z.string().max(200).optional(),
});

const categoryPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  description: z.string().max(4000).optional(),
  sort_order: z.number().int().optional(),
  auto_min_score: z.number().min(0).max(1).nullable().optional(),
});

const membershipSchema = z.object({ category_id: z.number().int().positive() });
const bootstrapSchema = z.object({ force: z.boolean().optional() });

const decideSchema = z.object({
  decision: z.enum(["accept", "update", "reject"]),
  edits: z.object({
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(100000).optional(),
    category: z.string().max(200).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    systems: z.array(z.string().max(100)).max(50).optional(),
    source: z.string().max(1000).optional(),
  }).optional(),
  note: z.string().max(4000).optional(),
  decidedBy: z.string().max(200).optional(),
});

const profileSchema = z.object({
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(50).optional(),
  role: z.string().max(500).optional(),
  org: z.string().max(500).optional(),
  relationships: z.string().max(4000).optional(),
  summary: z.string().max(20000).optional(),
  addFact: z.object({
    fact: z.string().min(1).max(4000),
    source: z.string().max(1000).optional(),
    by: z.string().max(200).optional(),
  }).optional(),
  by: z.string().max(200).optional(),
});

const seedSchema = z.object({
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  category_ids: z.array(z.number().int().positive()).max(50).optional(),
});

// ─── Static routes (declared before /:id) ─────────────────────────────────

// GET /api/kb/search?q=&type=&limit=
router.get("/search", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.status(400).json({ error: "q is required" }); return; }
  const typeParam = String(req.query.type ?? "all");
  const type = (["all", "knowledge", "profile"].includes(typeParam) ? typeParam : "all") as "all" | "knowledge" | "profile";
  const limitRaw = parseInt(String(req.query.limit ?? "8"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 8;
  const started = Date.now();
  try {
    const results = await hybridSearch(q, { type, limit });
    // Attach category memberships (id + name + breadcrumb) to knowledge hits.
    const enriched = results.map((r) =>
      r.type === "knowledge" ? { ...r, categories: membershipsForEntry(r.id) } : r
    );
    // Hybrid search always returns the top-N by a *normalized* score, so a raw count
    // is a useless hit signal (even gibberish returns something). Judge relevance by an
    // ABSOLUTE measure: a keyword (FTS) match, or a raw vector cosine above a floor.
    const vecReady = embeddingsReady();
    const topSim = results.length ? Math.max(...results.map((r) => r.sim)) : 0;
    const kwMatched = results.some((r) => r.kw);
    // Semantic cosine is the honest relevance measure. When embeddings are ready (the
    // normal case) judge purely on it — FTS matches on common words ("how", "to") would
    // otherwise mark off-topic queries as hits. Fall back to keyword-match only during
    // the brief warmup before the embedding model is loaded.
    const hit = vecReady ? topSim >= KB_HIT_MIN_SIM : kwMatched;
    const searchAgent = callerAgent(req);
    // A genuine miss → actionable "knowledge wanted" backlog item (deduped).
    if (!hit) recordWanted(q, searchAgent);
    logAccess({
      action: "search",
      agent: searchAgent,
      query: q,
      type_filter: type,
      result_count: results.length,
      // Log the raw top cosine (absolute, comparable across queries) — null when FTS-only.
      top_score: vecReady && results.length ? Number(topSim.toFixed(4)) : null,
      hit,
      result_ids: results.filter((r) => r.type === "knowledge").map((r) => r.id).slice(0, 10),
      latency_ms: Date.now() - started,
      embeddings_ready: vecReady,
    });
    res.json({ query: q, type, embeddingsReady: embeddingsReady(), results: enriched });
  } catch (err) {
    logger.error({ err }, "KB search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// POST /api/kb/propose
router.post("/propose", validate(proposeSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof proposeSchema>;
  try {
    let conflicts: Awaited<ReturnType<typeof scanConflicts>> = [];
    if (body.title || body.body) {
      conflicts = await scanConflicts({
        title: body.title ?? "",
        body: body.body ?? "",
        tags: body.tags,
        systems: body.systems,
      });
    }
    const { entry_id, pending_id } = createProposal({
      kind: body.kind,
      entry_id: body.entry_id ?? null,
      title: body.title,
      body: body.body,
      category: body.category,
      tags: body.tags,
      systems: body.systems,
      source: body.source,
      agent: body.agent,
      rationale: body.rationale,
      conflicts,
      wanted_id: body.wanted_id,
    });
    // Manual category pins (source='manual') — these stick and override auto.
    if (entry_id != null && body.category_ids?.length) {
      for (const cid of body.category_ids) {
        if (getCategory(cid)) addMembership(entry_id, cid);
      }
    }
    // Notify the human: SSE (dashboard live badge + Android local notification) + web-push (dashboard background).
    const kbTitle = body.title || (body.kind === "edit" ? `Edit to entry #${body.entry_id}` : "New knowledge");
    broadcast("knowledge-pending", {
      pending_id, entry_id, kind: body.kind, title: kbTitle,
      proposing_agent: body.agent ?? null, conflicts: conflicts.length,
    });
    sendPushToAll(
      "Knowledge to review",
      `${body.agent ? body.agent + " proposed: " : ""}${kbTitle}${conflicts.length ? ` (${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""})` : ""}`,
      "/knowledge/pending",
    ).catch((err) => logger.warn({ err }, "KB push notify failed"));
    logAccess({ action: "propose", agent: body.agent ?? callerAgent(req), entry_id });
    res.json({ entry_id, pending_id, conflicts });
  } catch (err) {
    logger.error({ err }, "KB propose failed");
    res.status(500).json({ error: "Propose failed" });
  }
});

// GET /api/kb/pending
router.get("/pending", (_req: Request, res: Response) => {
  res.json({ data: listPending() });
});

// POST /api/kb/pending/:id/decide
router.post("/pending/:id/decide", validate(decideSchema), async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof decideSchema>;
  const result = decideProposal(id, body);
  if (!result) { res.status(404).json({ error: "Proposal not found or already decided" }); return; }
  logger.info({ id, decision: body.decision, decidedBy: body.decidedBy }, "KB proposal decided");
  // On approval, auto-file the now-approved entry into the category tree. Safe to
  // call even if the vector isn't ready yet (classifyEntry embeds on demand); the
  // background embedder will also re-run this after any (re)embedding.
  if ((body.decision === "accept" || body.decision === "update") && result.entry_id != null) {
    classifyEntry(result.entry_id).catch((err) => logger.warn({ err, id: result.entry_id }, "KB classifyEntry after decide failed"));
  }
  res.json(result);
});

// GET /api/kb/profiles
router.get("/profiles", (_req: Request, res: Response) => {
  res.json({ data: listProfiles() });
});

// GET /api/kb/profiles/:name
router.get("/profiles/:name", (req: Request, res: Response) => {
  const profile = getProfile(String(req.params.name));
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(profile);
});

// POST /api/kb/profiles — auto-applied, no approval
router.post("/profiles", validate(profileSchema), (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof profileSchema>;
  try {
    const profile = upsertProfile(body);
    res.json(profile);
  } catch (err) {
    logger.error({ err }, "KB profile upsert failed");
    res.status(500).json({ error: "Profile upsert failed" });
  }
});

// GET /api/kb/stats
router.get("/stats", (_req: Request, res: Response) => {
  res.json({ ...stats(), embeddingsReady: embeddingsReady(), embedDim: embeddingDim() });
});

// GET /api/kb/analytics?days=30 — usage + effectiveness metrics from the access log.
router.get("/analytics", (req: Request, res: Response) => {
  const daysRaw = parseInt(String(req.query.days ?? "30"), 10);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 30;
  try {
    res.json(accessAnalytics(days));
  } catch (err) {
    logger.error({ err }, "KB analytics failed");
    res.status(500).json({ error: "Analytics failed" });
  }
});

// POST /api/kb/wanted — explicitly log a knowledge gap, even when a search DID return
// results but they didn't answer the question (a note explains why). Deduped by query.
router.post("/wanted", (req: Request, res: Response) => {
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 3) { res.status(400).json({ error: "query is required" }); return; }
  const note = req.body?.note != null ? String(req.body.note).slice(0, 2000) : null;
  const agent = callerAgent(req) || (req.body?.agent ? String(req.body.agent) : null);
  const id = recordWanted(query, agent, note);
  if (id == null) { res.status(422).json({ error: "query too trivial to log (needs a real word, >=8 chars)" }); return; }
  res.json({ ok: true, wanted_id: id });
});

// GET /api/kb/wanted?status=open — the "knowledge wanted" backlog (misses to fill).
router.get("/wanted", (req: Request, res: Response) => {
  const statusParam = String(req.query.status ?? "open");
  const status = ["open", "filled", "dismissed"].includes(statusParam) ? statusParam : "open";
  res.json({ data: listWanted(status) });
});

// POST /api/kb/wanted/:id/decide — mark a wanted item filled/dismissed/open.
router.post("/wanted/:id/decide", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const status = String(req.body?.status ?? "");
  if (!["filled", "dismissed", "open"].includes(status)) {
    res.status(400).json({ error: "status must be filled|dismissed|open" }); return;
  }
  const ok = decideWanted(id, status as "filled" | "dismissed" | "open", req.body?.by, req.body?.filled_entry_id);
  if (!ok) { res.status(404).json({ error: "Wanted item not found" }); return; }
  res.json({ ok: true });
});

// POST /api/kb/seed — import operator markdown. Guarded: only runs on an empty
// corpus unless force=true.
router.post("/seed", validate(seedSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof seedSchema>;
  try {
    if (!body.force && !body.dryRun && countEntries() > 0) {
      res.status(409).json({ error: "Knowledge base is not empty. Pass force=true to seed anyway." });
      return;
    }
    const summary = await seedFromMemories({ dryRun: body.dryRun });
    // Optional manual pins applied to every seeded entry (rarely used).
    if (!body.dryRun && body.category_ids?.length) {
      // seedFromMemories doesn't return ids; pin against the most recent approved set.
      // (No-op unless categories exist; auto-classification handles the rest.)
      logger.info({ category_ids: body.category_ids }, "KB seed category_ids provided (auto-classify will file entries)");
    }
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "KB seed failed");
    res.status(500).json({ error: "Seed failed" });
  }
});

// ─── Categories & tree (all declared before /:id) ─────────────────────────

// GET /api/kb/tree — nested category tree with per-node counts.
router.get("/tree", (_req: Request, res: Response) => {
  res.json({ tree: buildTree() });
});

// GET /api/kb/categories — flat list.
router.get("/categories", (_req: Request, res: Response) => {
  res.json({ data: listCategories() });
});

// POST /api/kb/categories — create (marks embed_stale; embedder classifies existing
// entries into it).
router.post("/categories", validate(categoryCreateSchema), (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof categoryCreateSchema>;
  if (body.parent_id != null && !getCategory(body.parent_id)) {
    res.status(400).json({ error: "parent_id does not exist" }); return;
  }
  const cat = createCategory(body);
  res.json(cat);
});

// PATCH /api/kb/categories/:id — re-embeds + reclassifies if name/description/parent changed.
router.patch("/categories/:id", validate(categoryPatchSchema), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof categoryPatchSchema>;
  if (body.parent_id != null && body.parent_id === id) {
    res.status(400).json({ error: "A category cannot be its own parent" }); return;
  }
  if (body.parent_id != null && !getCategory(body.parent_id)) {
    res.status(400).json({ error: "parent_id does not exist" }); return;
  }
  const cat = updateCategory(id, body);
  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  res.json(cat);
});

// DELETE /api/kb/categories/:id — reparents children to its parent; membership rows
// cascade-delete via FK.
router.delete("/categories/:id", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ok = deleteCategory(id);
  if (!ok) { res.status(404).json({ error: "Category not found" }); return; }
  res.json({ ok: true, id });
});

// POST /api/kb/categories/bootstrap — create the starter taxonomy + classify entries.
router.post("/categories/bootstrap", validate(bootstrapSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof bootstrapSchema>;
  try {
    const result = await bootstrapTaxonomy(body.force ?? false);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "KB bootstrap failed");
    res.status(500).json({ error: "Bootstrap failed" });
  }
});

// POST /api/kb/entries/:id/categories — manual pin (sticks, overrides auto).
router.post("/entries/:id/categories", validate(membershipSchema), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { category_id } = req.body as z.infer<typeof membershipSchema>;
  if (!getCategory(category_id)) { res.status(404).json({ error: "Category not found" }); return; }
  addMembership(id, category_id);
  res.json({ ok: true, categories: membershipsForEntry(id) });
});

// DELETE /api/kb/entries/:id/categories/:catId — manual remove (suppress tombstone).
router.delete("/entries/:id/categories/:catId", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const catId = parseInt(String(req.params.catId), 10);
  if (!Number.isFinite(id) || !Number.isFinite(catId)) { res.status(400).json({ error: "Invalid id" }); return; }
  removeMembership(id, catId);
  res.json({ ok: true, categories: membershipsForEntry(id) });
});

// GET /api/kb/entries?category=<id>&descendants=0|1 — browse a category.
router.get("/entries", (req: Request, res: Response) => {
  const catId = parseInt(String(req.query.category ?? ""), 10);
  if (!Number.isFinite(catId)) { res.status(400).json({ error: "category query param is required" }); return; }
  if (!getCategory(catId)) { res.status(404).json({ error: "Category not found" }); return; }
  const descendants = String(req.query.descendants ?? "0") === "1";
  res.json({ category_id: catId, descendants, data: entriesInCategory(catId, descendants) });
});

// ─── Catch-all: GET /api/kb/:id ───────────────────────────────────────────

// GET /api/kb/:id/related — semantic neighbours ∪ category siblings.
router.get("/:id/related", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const data = await relatedEntries(id);
    logAccess({ action: "related", agent: callerAgent(req), entry_id: id });
    res.json({ entry_id: id, data });
  } catch (err) {
    logger.error({ err }, "KB related failed");
    res.status(500).json({ error: "Related lookup failed" });
  }
});

router.get("/:id", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const entry = getEntry(id);
  if (!entry || entry.status === "rejected") { res.status(404).json({ error: "Entry not found" }); return; }
  logAccess({ action: "view", agent: callerAgent(req), entry_id: id });
  res.json(withMemberships(entry));
});

export default router;
