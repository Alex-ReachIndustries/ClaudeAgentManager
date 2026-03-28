import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

/**
 * Express middleware factory for Zod schema validation.
 * Validates req.body against the given schema.
 * On success, replaces req.body with the parsed (and transformed) data.
 * On failure, returns 400 with field-level error details.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      res.status(400).json({ error: "Validation error", details });
      return;
    }
    req.body = result.data;
    next();
  };
}
