import { Router, type Request, type Response } from "express";
import { getRecentSystemAlerts, reportUsage } from "../system-alerts.js";
import { logger } from "../logger.js";

const router = Router();

router.get("/alerts", (_req: Request, res: Response) => {
  res.json(getRecentSystemAlerts());
});

// Usage report from the watchdog: {limit: "session"|"weekly", percent: 0-100, resets?: string}.
router.post("/alerts/usage", (req: Request, res: Response) => {
  const { limit, percent, resets } = req.body ?? {};
  if (limit !== "session" && limit !== "weekly") {
    res.status(400).json({ error: "limit must be 'session' or 'weekly'" });
    return;
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    res.status(400).json({ error: "percent must be an integer 0-100" });
    return;
  }
  if (resets !== undefined && (typeof resets !== "string" || resets.length > 100)) {
    res.status(400).json({ error: "resets must be a string of at most 100 characters" });
    return;
  }
  try {
    res.json({ alerted: reportUsage(limit, percent, resets) });
  } catch (err) {
    logger.error({ err }, "Error handling usage report");
    res.status(500).json({ error: "Failed to handle usage report" });
  }
});

export default router;
