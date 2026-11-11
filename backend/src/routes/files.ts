import { Router, type Request, type Response } from "express";
import { searchFiles } from "../db.js";
import { logger } from "../logger.js";

const router = Router();

// GET /api/files?q=&limit=&before= — file metadata from every agent, newest first.
// q matches part of the filename, part of the file id, or the start of the agent id.
router.get("/", (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.length > 200) {
    res.status(400).json({ error: "q must be at most 200 characters" });
    return;
  }
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const beforeRaw = req.query.before === undefined ? undefined : Number(req.query.before);
  if (beforeRaw !== undefined && (!Number.isInteger(beforeRaw) || beforeRaw < 1)) {
    res.status(400).json({ error: "before must be a positive integer file id" });
    return;
  }
  try {
    res.json(searchFiles(q, limit, beforeRaw));
  } catch (err) {
    logger.error({ err }, "Error searching files");
    res.status(500).json({ error: "Failed to search files" });
  }
});

export default router;
