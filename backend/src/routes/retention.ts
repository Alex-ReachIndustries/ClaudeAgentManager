import { Router, type Request, type Response } from "express";
import { setSetting } from "../db.js";
import { getRetentionStatus, getRetentionSettings, runRetention } from "../retention.js";
import { validate } from "../middleware/validate.js";
import { retentionSettingsSchema } from "../schemas.js";
import { logger } from "../logger.js";

const router = Router();

// GET /status — returns current settings + last run stats
router.get("/status", (_req: Request, res: Response) => {
  try {
    const status = getRetentionStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, "Error getting retention status");
    res.status(500).json({ error: "Failed to get retention status" });
  }
});

// POST /run — trigger manual retention run
router.post("/run", (_req: Request, res: Response) => {
  try {
    const stats = runRetention();
    res.json({ ok: true, stats });
  } catch (err) {
    logger.error({ err }, "Error running retention");
    res.status(500).json({ error: "Failed to run retention" });
  }
});

// PATCH /settings — update retention settings
router.patch("/settings", validate(retentionSettingsSchema), (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const validKeys = [
      "retention_archive_days",
      "retention_update_days",
      "retention_message_days",
      "retention_enabled",
      "retention_dry_run",
    ];

    for (const key of validKeys) {
      if (body[key] !== undefined) {
        setSetting(key, JSON.stringify(body[key]));
      }
    }

    const settings = getRetentionSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error({ err }, "Error updating retention settings");
    res.status(500).json({ error: "Failed to update retention settings" });
  }
});

export default router;
