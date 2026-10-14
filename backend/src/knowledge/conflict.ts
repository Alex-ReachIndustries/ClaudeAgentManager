// Duplicate / contradiction detection. At propose time (and during seeding) we
// compare the incoming text against the approved corpus and flag anything that
// looks like the same subject — high cosine similarity OR strong title/keyword
// overlap — so a human can verify it isn't a duplicate or a contradiction.
import { embed, embeddingsReady, cosine } from "./embeddings.js";
import { listEntriesForVector, ConflictFlag } from "./store.js";

const COSINE_THRESHOLD = 0.86;
const OVERLAP_THRESHOLD = 0.6; // Jaccard over significant title/keyword tokens

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "how", "what", "with", "this", "that", "from", "by", "at", "as", "it",
]);

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * The approved entry most similar to a proposed entry, by raw vector cosine — the duplicate
 * gate on POST /propose. Embeds the same text shape the background embedder stores (title,
 * body, tags, systems) so a verbatim duplicate scores ~1.0. Returns null when the embedding
 * model isn't ready yet (the gate then can't judge, and lets the proposal through to review).
 */
export async function topApprovedMatch(input: {
  title: string; body: string; tags?: string[]; systems?: string[];
}): Promise<{ id: number; title: string; sim: number } | null> {
  if (!embeddingsReady()) return null;
  const entries = listEntriesForVector().filter((e) => e.status === "approved");
  if (entries.length === 0) return null;
  let qvec: Float32Array;
  try {
    qvec = await embed([input.title, input.body, (input.tags ?? []).join(" "), (input.systems ?? []).join(" ")]
      .filter(Boolean).join("\n").slice(0, 8000), false);
  } catch {
    return null;
  }
  let best: { id: number; title: string; sim: number } | null = null;
  for (const e of entries) {
    const sim = cosine(qvec, e.vec);
    if (!best || sim > best.sim) best = { id: e.id, title: e.title, sim };
  }
  return best;
}

export const DUPLICATE_SIM = Number.parseFloat(process.env.KB_DUPLICATE_SIM || "0.86");

export async function scanConflicts(input: {
  title: string; body: string; tags?: string[]; systems?: string[];
}): Promise<ConflictFlag[]> {
  const flags: ConflictFlag[] = [];
  const entries = listEntriesForVector().filter((e) => e.status === "approved");
  if (entries.length === 0) return flags;

  const text = `${input.title}\n${input.body}`;
  const myTokens = tokens(`${input.title} ${(input.tags ?? []).join(" ")} ${(input.systems ?? []).join(" ")}`);

  let qvec: Float32Array | null = null;
  if (embeddingsReady()) {
    try { qvec = await embed(text, false); } catch { qvec = null; }
  }

  for (const e of entries) {
    let sim = 0;
    if (qvec) sim = cosine(qvec, e.vec);
    const overlap = jaccard(myTokens, tokens(`${e.title} ${e.tags.join(" ")} ${e.systems.join(" ")}`));

    if (sim >= COSINE_THRESHOLD || overlap >= OVERLAP_THRESHOLD) {
      const reason = sim >= COSINE_THRESHOLD
        ? `similarity ${sim.toFixed(2)}`
        : `title/keyword overlap ${overlap.toFixed(2)}`;
      flags.push({
        entry_id: e.id,
        title: e.title,
        note: `Very similar to #${e.id} "${e.title}" (${reason}) — verify this isn't a duplicate or contradiction`,
      });
    }
  }

  // Strongest matches first, cap the noise.
  return flags.slice(0, 5);
}
