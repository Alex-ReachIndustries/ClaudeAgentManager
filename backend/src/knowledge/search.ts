// Hybrid search over the Knowledge Hub: combines FTS5 keyword ranking (bm25) with
// dense-vector cosine similarity, min-max normalizing each signal and blending them
// ~50/50. Pending entries are included but carry their status so callers can flag
// them as unverified. Falls back to FTS-only while the embedding model is warming up.
import { embed, embeddingsReady, cosine } from "./embeddings.js";
import { searchFTS, listEntriesForVector, listProfilesForVector, makeSnippet, FtsHit, getEntriesByIds } from "./store.js";
import { logger } from "../logger.js";

export interface SearchResult {
  id: number;
  type: "knowledge" | "profile";
  title: string;
  snippet: string;
  status: string;
  score: number;      // normalized 0-1 blend, for ranking/display (relative to this result set)
  sim: number;        // RAW vector cosine (absolute, comparable across queries); 0 if vector not used
  kw: boolean;        // true if this result matched the keyword (FTS) index
  tags: string[];
  systems: string[];
}

interface Acc {
  id: number;
  type: "knowledge" | "profile";
  title: string;
  snippet: string;
  status: string;
  tags: string[];
  systems: string[];
  fts: number;
  vec: number;
}

function normalize(values: number[]): (v: number) => number {
  if (values.length === 0) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return () => (values.length ? 1 : 0);
  return (v: number) => (v - min) / (max - min);
}

/**
 * Knowledge-entry ids the query explicitly references. Agents cite entries as "[455]", and
 * search for them as "KB 154", "kb 126", "id:270", "#455" or a bare "455" — none of which
 * semantic search can match (7 of the last 34 zero-hit searches, 2026-10-06). A bare number
 * counts only when it is the whole query, so "port 3001" or "PR 2094" don't resolve to entries.
 */
export function referencedEntryIds(query: string): number[] {
  const q = query.trim();
  const ids: number[] = [];
  const whole = q.match(/^#?\[?(\d{1,7})\]?$/);
  if (whole) ids.push(Number(whole[1]));
  // "#N" only counts as the whole query (above): in text it is usually a PR/issue ("PR #2094").
  for (const m of q.matchAll(/(?:\b(?:kb|id|entry)\s*[-:#]?\s*|\[)(\d{1,7})\]?/gi)) ids.push(Number(m[1]));
  return [...new Set(ids)].filter((n) => n > 0);
}

export async function hybridSearch(
  query: string,
  opts: { type?: "all" | "knowledge" | "profile"; limit?: number } = {}
): Promise<SearchResult[]> {
  const type = opts.type ?? "all";
  const limit = opts.limit ?? 8;

  // Exact id references come first, as certain hits (sim 1 so callers' relevance checks pass).
  const byId: SearchResult[] = type === "profile" ? [] : getEntriesByIds(referencedEntryIds(query)).map((e) => ({
    id: e.id, type: "knowledge" as const, title: e.title, snippet: makeSnippet(e.body), status: e.status,
    score: 1, sim: 1, kw: true, tags: e.tags, systems: e.systems,
  }));
  if (byId.length) {
    const rest = (await hybridSearchInner(query, type, limit)).filter((r) => !(r.type === "knowledge" && byId.some((b) => b.id === r.id)));
    return [...byId, ...rest].slice(0, limit);
  }
  return hybridSearchInner(query, type, limit);
}

async function hybridSearchInner(
  query: string,
  type: "all" | "knowledge" | "profile",
  limit: number
): Promise<SearchResult[]> {
  const acc = new Map<string, Acc>();
  const key = (t: string, id: number) => `${t}:${id}`;

  // ── FTS candidates ──
  const ftsHits: FtsHit[] = searchFTS(query, { type, limit: Math.max(limit * 3, 24) });
  for (const h of ftsHits) {
    acc.set(key(h.type, h.id), {
      id: h.id, type: h.type, title: h.title, snippet: h.snippet, status: h.status,
      tags: h.tags, systems: h.systems, fts: h.ftsScore, vec: 0,
    });
  }

  // ── Vector candidates (only if the model is ready) ──
  let vecUsed = false;
  if (embeddingsReady()) {
    try {
      const qvec = await embed(query, true);
      if (type === "all" || type === "knowledge") {
        for (const e of listEntriesForVector()) {
          const sim = cosine(qvec, e.vec);
          const k = key("knowledge", e.id);
          const existing = acc.get(k);
          if (existing) { existing.vec = Math.max(existing.vec, sim); }
          else {
            acc.set(k, {
              id: e.id, type: "knowledge", title: e.title, snippet: makeSnippet(e.body),
              status: e.status, tags: e.tags, systems: e.systems, fts: 0, vec: sim,
            });
          }
        }
      }
      if (type === "all" || type === "profile") {
        for (const p of listProfilesForVector()) {
          const sim = cosine(qvec, p.vec);
          const k = key("profile", p.id);
          const existing = acc.get(k);
          if (existing) { existing.vec = Math.max(existing.vec, sim); }
          else {
            acc.set(k, {
              id: p.id, type: "profile", title: p.name, snippet: makeSnippet(p.summary),
              status: "approved", tags: [], systems: [], fts: 0, vec: sim,
            });
          }
        }
      }
      vecUsed = true;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "KB vector search failed; using FTS only");
    }
  }

  const all = [...acc.values()];
  if (all.length === 0) return [];

  const ftsNorm = normalize(all.filter((a) => a.fts > 0).map((a) => a.fts));
  const vecNorm = normalize(all.filter((a) => a.vec !== 0).map((a) => a.vec));

  const results: SearchResult[] = all.map((a) => {
    const fN = a.fts > 0 ? ftsNorm(a.fts) : 0;
    const vN = a.vec !== 0 ? vecNorm(a.vec) : 0;
    // Blend 50/50 when both signals exist; otherwise lean on whichever we have.
    const score = vecUsed ? 0.5 * fN + 0.5 * vN : fN;
    return {
      id: a.id, type: a.type, title: a.title, snippet: a.snippet, status: a.status,
      score: Number(score.toFixed(4)),
      sim: Number(a.vec.toFixed(4)), kw: a.fts > 0,
      tags: a.tags, systems: a.systems,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
