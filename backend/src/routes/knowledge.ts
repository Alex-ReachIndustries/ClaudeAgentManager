// Knowledge Hub HTTP API. Mounted at /api/kb. Global authMiddleware already applies.
// Route ordering matters: the static paths (/search, /pending, /profiles*, /stats,
// /seed) are declared BEFORE the catch-all /:id so they aren't shadowed.
import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";
import { hybridSearch } from "../knowledge/search.js";
import { scanConflicts } from "../knowledge/conflict.js";
import { seedFromMemories } from "../knowledge/seed.js";
import { embeddingsReady, embeddingDim } from "../knowledge/embeddings.js";
import {
  createProposal, getEntry, listPending, getPending, decideProposal,
  upsertProfile, getProfile, listProfiles, stats, countEntries,
} from "../knowledge/store.js";

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
}).refine((d) => d.kind === "edit" ? !!d.entry_id : !!d.title, {
  message: "kind 'new' requires title; kind 'edit' requires entry_id",
});

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
    res.json({ query: q, type, embeddingsReady: embeddingsReady(), results });
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
router.post("/pending/:id/decide", validate(decideSchema), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof decideSchema>;
  const result = decideProposal(id, body);
  if (!result) { res.status(404).json({ error: "Proposal not found or already decided" }); return; }
  logger.info({ id, decision: body.decision, decidedBy: body.decidedBy }, "KB proposal decided");
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
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "KB seed failed");
    res.status(500).json({ error: "Seed failed" });
  }
});

// ─── Catch-all: GET /api/kb/:id ───────────────────────────────────────────

router.get("/:id", (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const entry = getEntry(id);
  if (!entry || entry.status === "rejected") { res.status(404).json({ error: "Entry not found" }); return; }
  res.json(entry);
});

export default router;
