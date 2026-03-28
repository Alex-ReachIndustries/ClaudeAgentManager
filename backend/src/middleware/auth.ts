import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { getSetting, setSetting } from "../db.js";

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

export function getApiKey(): string {
  let key = getSetting("api_key");
  if (!key) {
    key = crypto.randomBytes(32).toString("hex");
    setSetting("api_key", key);
    console.log(`\n  API Key generated: ${key}\n  Save this for client configuration.\n`);
  }
  return key;
}

export function rotateApiKey(): string {
  const key = crypto.randomBytes(32).toString("hex");
  setSetting("api_key", key);
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
