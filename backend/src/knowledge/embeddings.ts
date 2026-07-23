// Local sentence embeddings for the Knowledge Hub — fully offline, no paid API.
// Uses transformers.js (@huggingface/transformers, ONNX) running in-process.
// Model: bge-small-en-v1.5 (384-dim). Downloaded once and cached under /app/data.
import { logger } from "../logger.js";
import path from "node:path";

// bge models want a short instruction prefixed to *queries* (not to stored docs).
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const MODEL_ID = process.env.KB_EMBED_MODEL || "Xenova/bge-small-en-v1.5";

type FeatureExtractor = (text: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;
let ready = false;
let embedDim = 384;

/** Lazily load the embedding pipeline (singleton). First call downloads+caches the model. */
async function getExtractor(): Promise<FeatureExtractor> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const tf = await import("@huggingface/transformers");
    // Cache model weights on the persistent data volume so they survive restarts.
    tf.env.cacheDir = process.env.KB_MODEL_CACHE || path.join(process.cwd(), "data", "hf-cache");
    tf.env.allowRemoteModels = true;
    const pipe = await tf.pipeline("feature-extraction", MODEL_ID);
    ready = true;
    logger.info({ model: MODEL_ID, cacheDir: tf.env.cacheDir }, "KB embedding model loaded");
    return pipe as unknown as FeatureExtractor;
  })();
  return extractorPromise;
}

/** Warm the model in the background at boot so the first real query isn't slow. */
export function warmEmbeddings(): void {
  getExtractor().catch((err) => logger.error({ err }, "KB embedding warmup failed"));
}

export function embeddingsReady(): boolean {
  return ready;
}

export function embeddingDim(): number {
  return embedDim;
}

/** Embed a single text → normalized Float32Array (mean-pooled, L2-normalized by the pipeline). */
export async function embed(text: string, isQuery = false): Promise<Float32Array> {
  const extractor = await getExtractor();
  const input = (isQuery ? QUERY_PREFIX : "") + (text || "").slice(0, 8000);
  const out = await extractor(input, { pooling: "mean", normalize: true });
  const vec = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data as number[]);
  embedDim = vec.length;
  return vec;
}

/** Serialize a vector to a Buffer for BLOB storage (little-endian Float32). */
export function vectorToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Deserialize a stored BLOB back to Float32Array. */
export function bufferToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** Cosine similarity. Vectors are already L2-normalized, so this is a dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
