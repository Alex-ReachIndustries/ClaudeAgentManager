// TOTP (RFC 6238) code generation, base32 decode, and AES-256-GCM
// envelope for at-rest secret storage. No third-party dependency — uses
// Node's built-in crypto module.
//
// The TOTP service is for *agent-managed debug accounts only*. See
// ~/.claude/memory/feedback_peer_machines.md and the planning thread on the
// dashboard for the security model.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

// --- Master key bootstrap ---
// 32 bytes, generated on first run, stored at /app/data/totp-master-key
// (the backend container's persistent volume). Mode 0600. NEVER an env var
// (avoids leaks via process env / docker inspect / logs).

const KEY_PATH = process.env.TOTP_KEY_PATH || "/app/data/totp-master-key";

let cachedKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    if (fs.existsSync(KEY_PATH)) {
      const buf = fs.readFileSync(KEY_PATH);
      if (buf.length !== 32) throw new Error(`master key wrong length: ${buf.length}, expected 32`);
      cachedKey = buf;
      return buf;
    }
    // First run: generate + persist
    const buf = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    fs.writeFileSync(KEY_PATH, buf, { mode: 0o600 });
    fs.chmodSync(KEY_PATH, 0o600);
    cachedKey = buf;
    logger.info({ path: KEY_PATH }, "TOTP master key generated and stored");
    return buf;
  } catch (err) {
    logger.error({ err, path: KEY_PATH }, "Failed to load/generate TOTP master key");
    throw err;
  }
}

// --- AES-256-GCM envelope ---
// Returns { ciphertext, iv, authTag }. Each call generates a fresh 12-byte IV.

export interface Envelope {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string): Envelope {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(env: Envelope): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, env.iv);
  decipher.setAuthTag(env.authTag);
  const plaintext = Buffer.concat([decipher.update(env.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// --- Base32 decode (RFC 4648, lenient: ignores whitespace + padding) ---

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=]+/g, "");
  if (cleaned.length === 0) throw new Error("empty base32 input");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// --- TOTP code generation (RFC 6238) ---

export interface TotpParams {
  secret: string;            // base32-encoded
  digits?: number;           // default 6
  period?: number;           // default 30 (seconds)
  algorithm?: "SHA1" | "SHA256" | "SHA512";  // default SHA1
  timestamp?: number;        // epoch seconds; default Date.now()/1000
}

export interface TotpCode {
  code: string;
  validForSeconds: number;
  period: number;
}

export function generateTotp(params: TotpParams): TotpCode {
  const digits = params.digits ?? 6;
  const period = params.period ?? 30;
  const algorithm = params.algorithm ?? "SHA1";
  const now = params.timestamp ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);

  // 8-byte big-endian counter
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const keyBuf = base32Decode(params.secret);
  const hmac = crypto.createHmac(algorithm.toLowerCase(), keyBuf).update(counterBuf).digest();

  // Dynamic truncation per RFC 4226 §5.3
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  const codeNum = binCode % mod;
  const code = codeNum.toString().padStart(digits, "0");

  const elapsed = now % period;
  const validForSeconds = period - elapsed;

  return { code, validForSeconds, period };
}

// --- Validation helpers ---

export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,100}$/.test(name);
}

export function isValidBase32(secret: string): boolean {
  const cleaned = secret.toUpperCase().replace(/[\s=]+/g, "");
  if (cleaned.length === 0) return false;
  return /^[A-Z2-7]+$/.test(cleaned);
}
