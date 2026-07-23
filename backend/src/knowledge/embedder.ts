// Background embedding worker. Every ~5s it embeds a batch of rows flagged
// embed_stale = 1 (entries + profiles), stores the vectors, and clears the flag.
// Model load happens lazily in embeddings.ts (warmed at boot); until it's ready
// this worker simply idles.
import { embed, embeddingsReady, embeddingDim, vectorToBuffer } from "./embeddings.js";
import {
  staleEntries, staleProfiles, markEntryEmbedding, markProfileEmbedding,
} from "./store.js";
import {
  staleCategories, markCategoryEmbedding, catText, classifyEntry, classifyCategory,
} from "./categories.js";
import { logger } from "../logger.js";

const INTERVAL_MS = 5000;
const BATCH = 16;

let timer: NodeJS.Timeout | null = null;
let running = false;

function entryText(row: Record<string, unknown>): string {
  const tags = safeArr(row.tags);
  const systems = safeArr(row.systems);
  return [String(row.title ?? ""), String(row.body ?? ""), tags.join(" "), systems.join(" ")]
    .filter(Boolean).join("\n").slice(0, 8000);
}

function profileText(row: Record<string, unknown>): string {
  let facts = "";
  try {
    const parsed = JSON.parse(String(row.facts ?? "[]"));
    if (Array.isArray(parsed)) facts = parsed.map((f) => (f && typeof f === "object" ? String((f as { fact?: string }).fact ?? "") : String(f))).join(" ");
  } catch { /* ignore */ }
  return [String(row.name ?? ""), String(row.role ?? ""), String(row.org ?? ""), String(row.summary ?? ""), facts]
    .filter(Boolean).join("\n").slice(0, 8000);
}

function safeArr(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}

/** Run one embedding pass. Returns the number of rows (re)embedded. */
export async function embedNow(): Promise<number> {
  if (!embeddingsReady()) return 0;
  let count = 0;

  const entries = staleEntries(BATCH);
  for (const row of entries) {
    try {
      const vec = await embed(entryText(row), false);
      markEntryEmbedding(Number(row.id), vectorToBuffer(vec));
      count++;
      // Now that a fresh vector exists, (re)file this entry into the category tree.
      await classifyEntry(Number(row.id));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), id: row.id }, "KB entry embed failed");
    }
  }

  // Categories: embed name+ancestors+description, then pull matching entries in.
  const categories = staleCategories(BATCH);
  for (const row of categories) {
    try {
      const vec = await embed(catText(row as { name: string; parent_id: number | null; description?: string | null }), false);
      markCategoryEmbedding(Number(row.id), vectorToBuffer(vec));
      count++;
      await classifyCategory(Number(row.id));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), id: row.id }, "KB category embed failed");
    }
  }

  const profiles = staleProfiles(BATCH);
  for (const row of profiles) {
    try {
      const vec = await embed(profileText(row), false);
      markProfileEmbedding(Number(row.id), vectorToBuffer(vec));
      count++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), id: row.id }, "KB profile embed failed");
    }
  }

  if (count > 0) logger.info({ count, dim: embeddingDim() }, "KB embedder pass complete");
  return count;
}

export function startEmbedder(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    embedNow()
      .catch((err) => logger.error({ err }, "KB embedder pass errored"))
      .finally(() => { running = false; });
  }, INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info("KB embedder started");
}

export function stopEmbedder(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
