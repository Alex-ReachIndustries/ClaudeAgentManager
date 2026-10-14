// Shared relevance thresholds, so the search "hit" judgement, the per-result relevance
// label and the analytics "weak" band can never drift apart.
//
// KB_HIT_MIN_SIM: a search is a hit (and a result is "strong") when its raw vector cosine
// reaches this. 0.55 counted near-misses as hits and flattered the hit rate; 0.68 is where
// bge-small-en-v1.5 matches start being genuinely on-topic.
export const KB_HIT_MIN_SIM = Number.parseFloat(process.env.KB_HIT_MIN_SIM || "0.68");

// KB_WEAK_MAX_SIM: a hit whose top cosine is below this is "weak" (on-topic but thin) in
// analytics. It must sit above the hit floor, otherwise the weak band would be empty.
const weakRaw = Number.parseFloat(process.env.KB_WEAK_MAX_SIM || "0.75");
export const KB_WEAK_MAX_SIM = Math.max(weakRaw, KB_HIT_MIN_SIM + 0.01);
