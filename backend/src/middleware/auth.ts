import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "../db.js";
import { logger } from "../logger.js";

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";
const BACKUP_PATH = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : "/app/data", "api-key.backup");

function writeBackupKey(key: string): void {
  try {
    fs.writeFileSync(BACKUP_PATH, key, "utf-8");
  } catch (err) {
    logger.warn(`Failed to write API key backup: ${err}`);
  }
}

function readBackupKey(): string | undefined {
  try {
    const key = fs.readFileSync(BACKUP_PATH, "utf-8").trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function getApiKey(): string {
  // 1. Environment variable takes precedence
  const envKey = process.env.API_KEY?.trim();
  if (envKey) {
    const dbKey = getSetting("api_key");
    if (dbKey !== envKey) {
      setSetting("api_key", envKey);
      writeBackupKey(envKey);
      logger.info("API key set from environment variable");
    }
    return envKey;
  }

  // 2. Check DB (normal path when DB exists)
  let key = getSetting("api_key");
  if (key) return key;

  // 3. Restore from backup file
  key = readBackupKey();
  if (key) {
    setSetting("api_key", key);
    logger.info("API key restored from backup file");
    return key;
  }

  // 4. Generate new key (first-ever start)
  key = crypto.randomBytes(32).toString("hex");
  setSetting("api_key", key);
  writeBackupKey(key);
  logger.info(`API Key generated: ${key}`);
  return key;
}

export function rotateApiKey(): string {
  const key = crypto.randomBytes(32).toString("hex");
  setSetting("api_key", key);
  writeBackupKey(key);
  return key;
}

/** Routes that never require auth */
const EXEMPT_PATHS = new Set(["/api/health"]);

function isExempt(path: string): boolean {
  return EXEMPT_PATHS.has(path);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    next();
    return;
  }

  if (isExempt(req.path)) {
    next();
    return;
  }

  // SSE endpoint uses query param auth
  if (req.path === "/api/events") {
    const token = req.query.token as string | undefined;
    if (token && timingSafeCompare(token, getApiKey())) {
      next();
      return;
    }
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  // All other endpoints use Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  const token = authHeader.slice(7);
  if (!timingSafeCompare(token, getApiKey())) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
