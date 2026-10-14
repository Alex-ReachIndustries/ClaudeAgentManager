// Shared relevance thresholds, so the search "hit" judgement, the per-result relevance
// label and the analytics "weak" band can never drift apart.
//
// KB_HIT_MIN_SIM: a search is a hit (and a result is "strong") when its raw vector cosine
// reaches this. Calibrated 2026-10-14 on the rewritten hub (bge-small-en-v1.5): for 20
// natural agent questions the correct entry scored 0.62–0.88 (median 0.77, 19/20 at rank 1);
// off-topic questions never topped 0.51. 0.60 sits in that gap. (0.68 mislabelled 4/20 right
// answers as weak and told agents to treat them as gaps.) Re-run the calibration if the
// embedding model changes.
export const KB_HIT_MIN_SIM = Number.parseFloat(process.env.KB_HIT_MIN_SIM || "0.60");

// KB_WEAK_MAX_SIM: a hit whose top cosine is below this is "weak" (on-topic but thin) in
// analytics. It must sit above the hit floor, otherwise the weak band would be empty.
const weakRaw = Number.parseFloat(process.env.KB_WEAK_MAX_SIM || "0.70");
export const KB_WEAK_MAX_SIM = Math.max(weakRaw, KB_HIT_MIN_SIM + 0.01);
