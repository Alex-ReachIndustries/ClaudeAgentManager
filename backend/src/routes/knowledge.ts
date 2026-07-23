// Knowledge Hub HTTP API. Mounted at /api/kb. Global authMiddleware already applies.
// Route ordering matters: the static paths (/search, /pending, /profiles*, /stats,
// /seed) are declared BEFORE the catch-all /:id so they aren't shadowed.
import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";
import { hybridSearch } from "../knowledge/search.js";
import { scanConflicts } from "../knowledge/conflict.js";
import { broadcast } from "../sse.js";
import { sendPushToAll } from "../push.js";
import { seedFromMemories } from "../knowledge/seed.js";
import { embeddingsReady, embeddingDim } from "../knowledge/embeddings.js";
import {
  createProposal, getEntry, listPending, getPending, decideProposal,
  upsertProfile, getProfile, listProfiles, stats, countEntries,
} from "../knowledge/store.js";
import {
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  buildTree, entriesInCategory, relatedEntries, membershipsForEntry, withMemberships,
  addMembership, removeMembership, classifyEntry, bootstrapTaxonomy,
} from "../knowledge/categories.js";

const router: Router = express.Router();

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
  try {
    const results = await hybridSearch(q, { type, limit });
    // Attach category memberships (id + name + breadcrumb) to knowledge hits.
    const enriched = results.map((r) =>
      r.type === "knowledge" ? { ...r, categories: membershipsForEntry(r.id) } : r
    );
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
    res.json({ entry_id: id, data: await relatedEntries(id) });
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
  res.json(withMemberships(entry));
});

export default router;
