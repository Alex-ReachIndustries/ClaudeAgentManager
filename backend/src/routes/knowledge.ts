// Knowledge Hub HTTP API. Mounted at /api/kb. Global authMiddleware already applies.
// Route ordering matters: the static paths (/search, /pending, /profiles*, /stats,
// /seed) are declared BEFORE the catch-all /:id so they aren't shadowed.
import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";
import { getDb } from "../db.js";
import { hybridSearch } from "../knowledge/search.js";
import { scanConflicts, topApprovedMatch, DUPLICATE_SIM } from "../knowledge/conflict.js";
import { KB_HIT_MIN_SIM } from "../knowledge/thresholds.js";
import { reviewQueue, submitReview, distributeReviews, runLifecycle } from "../knowledge/review.js";
import { broadcast } from "../sse.js";
import { sendPushToAll } from "../push.js";
import { seedFromMemories } from "../knowledge/seed.js";
import { embeddingsReady, embeddingDim } from "../knowledge/embeddings.js";
import {
  createProposal, getEntry, listPending, getPending, decideProposal,
  upsertProfile, getProfile, listProfiles, stats, countEntries,
  logAccess, accessAnalytics, recordWanted, listWanted, decideWanted,
  compactEntry, getEntriesCompact, listEntriesPaged,
} from "../knowledge/store.js";
import {
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  buildTree, entriesInCategory, relatedEntries, membershipsForEntry, withMemberships,
  addMembership, removeMembership, classifyEntry, bootstrapTaxonomy,
} from "../knowledge/categories.js";

const router: Router = express.Router();

// Absolute relevance floor (KB_HIT_MIN_SIM, knowledge/thresholds.ts): a search counts as a
// "hit", and a result as "strong", when its raw vector cosine reaches it. Tuned for
// bge-small-en-v1.5; override via env if the embedding model changes.

// Proposal size gate. Entries are read inline in agents' contexts, so they must stay short
// and lead with the rule.
const MAX_TITLE = 120;
const MAX_BODY = 2500;
const MAX_FIRST_LINE = 300;

// Best-effort attribution of the calling agent for the audit log. Agents pass their
// identity via ?agent= (the /kb command sends $CLAUDE_AGENT_ID) or an X-Agent-Id
// header; unattributed callers (e.g. the dashboard) are logged as NULL / "(unknown)".
//
// Store the RAW id — do NOT resolve it to the agent's title here. This used to write the
// friendly title "so the analytics read as names, not UUIDs", but titles are unstable and
// agent-chosen, so writing them fragmented the log badly: one agent appeared as "<uuid>",
// "94b3599b (frontend dev)", "AIGroupPortal - PM" vs "AIGroupPortal-PM", "Cam (Desktop)" vs
// "Cam", and once as "C". Nothing could be joined on identity — including the search-nudge
// check, which looked up a UUID and never matched a title-keyed row, so the nudge fired at
// agents that HAD just searched. The id is stable for the life of the agent; analytics
// resolve it to a display name at READ time instead (see accessAnalytics by_agent).
//
// Precedence: ?agent= query, then a body `agent` field, then the X-Agent-Id (or legacy
// X-Agent) header — so a client hook that only sets the header still gets every call credited.
function callerAgent(req: Request): string | null {
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  for (const v of [req.query.agent, body.agent, req.header("x-agent-id"), req.header("x-agent")]) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return null;
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const proposeSchema = z.object({
  // retire/verify: lifecycle reviews of an existing entry (entry_id + rationale).
  kind: z.enum(["new", "edit", "retire", "verify"]),
  entry_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(100000).optional(),
  // kind 'edit' only: text appended to the entry's current body as a new paragraph, so a
  // gotcha can be added without rewriting (and possibly mangling) the whole entry.
  append: z.string().min(1).max(100000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  systems: z.array(z.string().max(100)).max(50).optional(),
  source: z.string().max(1000).optional(),
  agent: z.string().max(200).optional(),
  rationale: z.string().max(4000).optional(),
  category_ids: z.array(z.number().int().positive()).max(50).optional(),
  wanted_id: z.number().int().positive().optional(),   // gap this fills; auto-resolved on approval
}).refine((d) => d.kind === "new" ? !!d.title : !!d.entry_id, {
  message: "kind 'new' requires title; kinds 'edit', 'retire' and 'verify' require entry_id",
});

const reviewSchema = z.object({
  agent: z.string().max(200).optional(),
  verdict: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional(),
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
  const minSimRaw = Number.parseFloat(String(req.query.min_sim ?? ""));
  const minSim = Number.isFinite(minSimRaw) ? Math.min(Math.max(minSimRaw, 0), 1) : null;
  const started = Date.now();
  try {
    const all = await hybridSearch(q, { type, limit });
    const vecReadyNow = embeddingsReady();
    // Strong = a genuine match: raw cosine at/above the hit floor, an exact id reference, or —
    // only while the vector model is warming up — a keyword match.
    const isStrong = (r: (typeof all)[number]) =>
      !!r.idMatch || (vecReadyNow ? r.sim >= KB_HIT_MIN_SIM : r.kw);
    // Optional min_sim filter (exact id references always pass).
    const results = minSim == null ? all : all.filter((r) => r.idMatch || r.sim >= minSim);
    // Attach category memberships (id + name + breadcrumb) to knowledge hits.
    const enriched = results.map((r) => {
      const out = { ...r, relevance: isStrong(r) ? "strong" : "weak" };
      return r.type === "knowledge" ? { ...out, categories: membershipsForEntry(r.id) } : out;
    });
    // Hybrid search always returns the top-N by a *normalized* score, so a raw count
    // is a useless hit signal (even gibberish returns something). Judge relevance by an
    // ABSOLUTE measure: a keyword (FTS) match, or a raw vector cosine above a floor.
    const vecReady = vecReadyNow;
    const topSim = all.length ? Math.max(...all.map((r) => r.sim)) : 0;
    const kwMatched = all.some((r) => r.kw);
    // Semantic cosine is the honest relevance measure. When embeddings are ready (the
    // normal case) judge purely on it — FTS matches on common words ("how", "to") would
    // otherwise mark off-topic queries as hits. Fall back to keyword-match only during
    // the brief warmup before the embedding model is loaded.
    const hit = all.some((r) => r.idMatch) || (vecReady ? topSim >= KB_HIT_MIN_SIM : kwMatched);
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
      top_score: vecReady && all.length ? Number(topSim.toFixed(4)) : null,
      hit,
      result_ids: results.filter((r) => r.type === "knowledge").map((r) => r.id).slice(0, 10),
      latency_ms: Date.now() - started,
      embeddings_ready: vecReady,
    });
    // gap: nothing strong came back — log a "wanted" item rather than act on weak matches.
    const gap = !enriched.some((r) => r.relevance === "strong");
    res.json({
      query: q, type, embeddingsReady: vecReady, gap,
      ...(gap ? { gap_hint: "No strong match. Don't act on weak results: log the gap (POST /api/kb/wanted {query,note}), get the answer, then propose it with that wanted_id." } : {}),
      results: enriched,
    });
  } catch (err) {
    logger.error({ err }, "KB search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

type GateError = { status: number; body: Record<string, unknown> };

function sizeError(field: string, actual: number, limit: number, hint: string): GateError {
  return { status: 400, body: { error: `${field} is ${actual} chars; the limit is ${limit}`, field, actual, limit, hint } };
}

/** Size + rule-first checks shared by every content-carrying proposal. */
function checkContent(title: string | undefined, body: string | undefined, appended: boolean): GateError | null {
  if (title != null && title.length > MAX_TITLE) {
    return sizeError("title", title.length, MAX_TITLE, "Use a short, scannable name; put the detail in the body.");
  }
  if (body != null) {
    if (body.length > MAX_BODY) {
      return sizeError("body", body.length, MAX_BODY, appended
        ? "With your append the entry would exceed the cap. Propose a tightened full body instead (kind:'edit' with body), or put the new point in its own entry."
        : "Keep one topic per entry: lead with the rule, cut background, split unrelated points into separate entries (link them by [id]).");
    }
    const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    if (firstLine.length > MAX_FIRST_LINE) {
      return sizeError("body first line", firstLine.length, MAX_FIRST_LINE,
        "The first line must be the actionable rule in one sentence (it is what search results show). Move the explanation to the lines below it.");
    }
  }
  return null;
}

// POST /api/kb/propose
router.post("/propose", validate(proposeSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof proposeSchema>;
  const agent = callerAgent(req);
  try {
    // ── Gate ──
    let current: Record<string, unknown> | undefined;
    if (body.kind !== "new") {
      current = getDb().prepare("SELECT id, title, body, status FROM knowledge_entries WHERE id = ?").get(body.entry_id) as Record<string, unknown> | undefined;
      if (!current || current.status === "rejected") {
        res.status(404).json({ error: `Entry ${body.entry_id} not found`, hint: "Search for the right entry id first (/kb <topic>), or propose kind:'new'." });
        return;
      }
      if ((body.kind === "retire" || body.kind === "verify") && current.status !== "approved") {
        res.status(400).json({ error: `kind '${body.kind}' applies only to approved entries; entry ${body.entry_id} is ${current.status}` });
        return;
      }
    }
    if (body.append != null) {
      if (body.kind !== "edit") { res.status(400).json({ error: "append is only valid with kind:'edit' (and entry_id)" }); return; }
      if (body.body != null) { res.status(400).json({ error: "Send either body (full replacement) or append (added to the current body), not both" }); return; }
    }
    if (body.kind === "new" && !(body.body ?? "").trim()) {
      res.status(400).json({ error: "kind 'new' requires a body", field: "body", hint: "First line = the actionable rule; then the why/how in a few lines." });
      return;
    }
    const proposedBody = body.append != null
      ? `${String(current?.body ?? "").trimEnd()}\n\n${body.append.trim()}`
      : body.body;
    const isContent = body.kind === "new" || body.kind === "edit";
    if (isContent) {
      const err = checkContent(body.title, proposedBody, body.append != null);
      if (err) { res.status(err.status).json(err.body); return; }
    }
    if (body.kind === "new") {
      const dup = await topApprovedMatch({ title: body.title ?? "", body: proposedBody ?? "", tags: body.tags, systems: body.systems });
      if (dup && dup.sim >= DUPLICATE_SIM) {
        res.status(409).json({
          error: `Near-duplicate of approved entry [${dup.id}] (similarity ${dup.sim.toFixed(2)})`,
          duplicate_of: { id: dup.id, title: dup.title },
          similarity: Number(dup.sim.toFixed(4)),
          hint: "propose kind:'edit' with entry_id instead",
        });
        return;
      }
    }

    let conflicts: Awaited<ReturnType<typeof scanConflicts>> = [];
    if (isContent && (body.title || proposedBody)) {
      conflicts = await scanConflicts({
        title: body.title ?? "",
        body: proposedBody ?? "",
        tags: body.tags,
        systems: body.systems,
      });
      // An edit always resembles the entry it edits — that is not a conflict.
      if (body.kind === "edit") conflicts = conflicts.filter((c) => c.entry_id !== body.entry_id);
    }
    const { entry_id, pending_id } = createProposal({
      kind: body.kind,
      entry_id: body.entry_id ?? null,
      title: isContent ? body.title : undefined,
      body: isContent ? proposedBody : undefined,
      category: body.category,
      tags: body.tags,
      systems: body.systems,
      source: body.source,
      agent: agent ?? undefined,
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
    const kbTitle = body.title || (body.kind === "new" ? "New knowledge" : `${body.kind[0].toUpperCase()}${body.kind.slice(1)} entry #${body.entry_id}`);
    broadcast("knowledge-pending", {
      pending_id, entry_id, kind: body.kind, title: kbTitle,
      proposing_agent: agent, conflicts: conflicts.length,
    });
    sendPushToAll(
      "Knowledge to review",
      `${agent ? agent + " proposed: " : ""}${kbTitle}${conflicts.length ? ` (${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""})` : ""}`,
      "/knowledge/pending",
    ).catch((err) => logger.warn({ err }, "KB push notify failed"));
    logAccess({ action: "propose", agent, entry_id });
    res.json({
      entry_id, pending_id, conflicts,
      review: "Peer review: two agreeing votes from other agents decide it (GET /api/kb/review-queue shows reviewers the oldest item).",
    });
  } catch (err) {
    logger.error({ err }, "KB propose failed");
    res.status(500).json({ error: "Propose failed" });
  }
});

// GET /api/kb/review-queue?agent=ID — the oldest pending item this agent may review
// (not proposed by it, not already voted on by it). At most one item.
router.get("/review-queue", (req: Request, res: Response) => {
  const agent = callerAgent(req);
  if (!agent) { res.status(400).json({ error: "agent is required (?agent=$CLAUDE_AGENT_ID or X-Agent-Id header)" }); return; }
  const item = reviewQueue(agent);
  res.json({ data: item ? [item] : [] });
});

// POST /api/kb/pending/:id/review {agent, verdict, note} — a peer vote. Two agreeing votes decide.
router.post("/pending/:id/review", validate(reviewSchema), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const agent = callerAgent(req);
  if (!agent) { res.status(400).json({ error: "agent is required (body.agent or X-Agent-Id header)" }); return; }
  const body = req.body as z.infer<typeof reviewSchema>;
  try {
    const out = submitReview(id, agent, body.verdict, body.note);
    if (!out.ok) { res.status(out.code).json({ error: out.error }); return; }
    logAccess({ action: "review", agent, entry_id: (getPending(id)?.entry_id as number | null) ?? null });
    if (out.status !== "pending") broadcast("knowledge-decided", { pending_id: id, status: out.status, decided_by: out.decided_by });
    res.json({ pending_id: id, ...out });
  } catch (err) {
    logger.error({ err }, "KB review failed");
    res.status(500).json({ error: "Review failed" });
  }
});

// POST /api/kb/review-sweep — run one review-distribution pass now (it also runs every 10 min).
router.post("/review-sweep", (_req: Request, res: Response) => {
  try { res.json({ sent: distributeReviews() }); }
  catch (err) { logger.error({ err }, "KB review sweep failed"); res.status(500).json({ error: "Sweep failed" }); }
});

// POST /api/kb/lifecycle/run {force} — run the lifecycle pass now (normally weekly).
router.post("/lifecycle/run", (req: Request, res: Response) => {
  try { res.json(runLifecycle(req.body?.force === true)); }
  catch (err) { logger.error({ err }, "KB lifecycle run failed"); res.status(500).json({ error: "Lifecycle run failed" }); }
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
  if (!body.decidedBy) {
    const hdr = req.header("x-agent-id");
    if (hdr && hdr.trim()) body.decidedBy = hdr.trim();
  }
  const result = decideProposal(id, body);
  if (!result) { res.status(404).json({ error: "Proposal not found or already decided" }); return; }
  logger.info({ id, decision: body.decision, decidedBy: body.decidedBy }, "KB proposal decided");
  // On approval, auto-file the now-approved entry into the category tree. Safe to
  // call even if the vector isn't ready yet (classifyEntry embeds on demand); the
  // background embedder will also re-run this after any (re)embedding.
  const decidedKind = String(getPending(id)?.kind ?? "");
  if ((body.decision === "accept" || body.decision === "update") && result.entry_id != null && decidedKind !== "retire") {
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
  const by = body.by ?? callerAgent(req) ?? undefined;
  try {
    const profile = upsertProfile({ ...body, by });
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
  const agent = callerAgent(req);
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
// GET /api/kb/entries?status=approved&limit=50&offset=0 — without a category: a paged,
// compact listing for tooling (status: approved|pending|superseded|all; limit ≤200).
router.get("/entries", (req: Request, res: Response) => {
  if (req.query.category == null || req.query.category === "") {
    const status = String(req.query.status ?? "approved");
    if (!["approved", "pending", "superseded", "all"].includes(status)) {
      res.status(400).json({ error: "status must be approved|pending|superseded|all" }); return;
    }
    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const { data, total } = listEntriesPaged(status, limit, offset);
    res.json({ status, limit, offset, total, data });
    return;
  }
  const catId = parseInt(String(req.query.category ?? ""), 10);
  if (!Number.isFinite(catId)) { res.status(400).json({ error: "category must be a numeric id" }); return; }
  if (!getCategory(catId)) { res.status(404).json({ error: "Category not found" }); return; }
  const descendants = String(req.query.descendants ?? "0") === "1";
  res.json({ category_id: catId, descendants, data: entriesInCategory(catId, descendants) });
});

// GET /api/kb/batch?ids=1,2,3 — up to 10 entries in compact form, in one call.
router.get("/batch", (req: Request, res: Response) => {
  const raw = String(req.query.ids ?? "").trim();
  const ids = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map((v) => Number(v)))];
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    res.status(400).json({ error: "ids must be a comma-separated list of entry ids, e.g. ?ids=12,34" }); return;
  }
  if (ids.length > 10) { res.status(400).json({ error: `At most 10 ids per batch (got ${ids.length})` }); return; }
  const { data, missing } = getEntriesCompact(ids);
  const agent = callerAgent(req);
  for (const e of data) logAccess({ action: "view", agent, entry_id: Number(e.id) });
  res.json({ data, missing });
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
  // ?format=compact → {id,title,body,tags,status,verified_at} only. (The full form never
  // ships the embedding either: mapEntry drops it.)
  if (String(req.query.format ?? "") === "compact") { res.json(compactEntry(entry)); return; }
  res.json(withMemberships(entry));
});

export default router;
