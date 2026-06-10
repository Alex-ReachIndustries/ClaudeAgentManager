import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

/**
 * Express middleware factory for Zod schema validation.
 * Validates req.body against the given schema.
 * On success, replaces req.body with the parsed (and transformed) data.
 * On failure, returns 400 with field-level error details.
 * An optional onFail hook runs before the 400 is sent (e.g. to flag the agent
 * for a full-rules re-injection when it sends a malformed request).
 */
export function validate(schema: ZodSchema, onFail?: (req: Request) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      if (onFail) {
        try { onFail(req); } catch { /* never block the 400 response */ }
      }
      res.status(400).json({ error: "Validation error", details });
      return;
    }
    req.body = result.data;
    next();
  };
}
