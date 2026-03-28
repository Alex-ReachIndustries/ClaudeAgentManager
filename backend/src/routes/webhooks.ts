import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { validate } from "../middleware/validate.js";
import { webhookCreateSchema, webhookUpdateSchema } from "../schemas.js";
import { logger } from "../logger.js";

const router = Router();

/** Extract a route param as a string */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

// GET / — list all webhooks
router.get("/", (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const webhooks = db.prepare("SELECT * FROM webhooks ORDER BY created_at DESC").all();
    res.json(webhooks);
  } catch (err) {
    logger.error({ err }, "Error listing webhooks");
    res.status(500).json({ error: "Failed to list webhooks" });
  }
});

// POST / — create a webhook
router.post("/", validate(webhookCreateSchema), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { url, events } = req.body;
    const result = db
      .prepare("INSERT INTO webhooks (url, events) VALUES (?, ?)")
      .run(url, JSON.stringify(events));
    const webhook = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(webhook);
  } catch (err) {
    logger.error({ err }, "Error creating webhook");
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

// PATCH /:id — update a webhook
router.patch("/:id", validate(webhookUpdateSchema), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(param(req, "id"), 10);

    const existing = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (req.body.url !== undefined) {
      setClauses.push("url = ?");
      values.push(req.body.url);
    }
    if (req.body.events !== undefined) {
      setClauses.push("events = ?");
      values.push(JSON.stringify(req.body.events));
    }
    if (req.body.active !== undefined) {
      setClauses.push("active = ?");
      values.push(req.body.active ? 1 : 0);
      // Reset failure count when re-enabling
      if (req.body.active) {
        setClauses.push("failure_count = 0");
      }
    }

    if (setClauses.length === 0) {
      res.json(existing);
      return;
    }

    values.push(id);
    db.prepare(`UPDATE webhooks SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Error updating webhook");
    res.status(500).json({ error: "Failed to update webhook" });
  }
});

// DELETE /:id — delete a webhook
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(param(req, "id"), 10);

    const existing = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error deleting webhook");
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

// POST /:id/test — send a test payload
router.post("/:id/test", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(param(req, "id"), 10);

    const webhook = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as
      | { id: number; url: string; events: string }
      | undefined;
    if (!webhook) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const testPayload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      agent: { id: "test-agent", title: "Test Agent", status: "active" },
      details: { message: "This is a test webhook delivery" },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    res.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (err) {
    logger.error({ err }, "Error testing webhook");
    res.status(500).json({ error: "Failed to test webhook", detail: String(err) });
  }
});

export default router;
