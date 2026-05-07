import rateLimit from "express-rate-limit";
import type { Request } from "express";

/** Extract agent ID from URL params for per-agent limiting */
function agentKey(req: Request): string {
  return (req.params as Record<string, string>).id || "unknown";
}

/** Agent updates: 60 requests per minute per agent */
export const agentUpdateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: agentKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded", retryAfter: 60 },
  validate: { xForwardedForHeader: false },
});

/** Launch requests: 60 per minute per IP */
export const launchLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded", retryAfter: 60 },
});
