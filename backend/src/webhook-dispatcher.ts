import { getDb } from "./db.js";
import { logger } from "./logger.js";

interface WebhookRow {
  id: number;
  url: string;
  events: string;
  active: number;
  failure_count: number;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  agent: Record<string, unknown> | null;
  details: unknown;
}

const MAX_RETRIES = 3;
const BACKOFF_BASE = 5; // 1s, 5s, 25s (5^0, 5^1, 5^2 seconds)
const AUTO_DISABLE_THRESHOLD = 10;

export function initWebhookDispatcher(): void {
  logger.info("Webhook dispatcher initialized");
}

export function dispatchWebhook(
  event: string,
  data: { agent?: Record<string, unknown> | null; details?: unknown }
): void {
  // Fire and forget — do not await
  _dispatchAll(event, data).catch((err) => {
    logger.error({ err, event }, "Webhook dispatch error");
  });
}

async function _dispatchAll(
  event: string,
  data: { agent?: Record<string, unknown> | null; details?: unknown }
): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, url, events, active, failure_count FROM webhooks WHERE active = 1")
    .all() as WebhookRow[];

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    agent: data.agent ?? null,
    details: data.details ?? null,
  };

  for (const hook of rows) {
    let events: string[];
    try {
      events = JSON.parse(hook.events);
    } catch {
      continue;
    }
    if (!events.includes(event)) continue;

    // Attempt delivery with retries
    _deliverWithRetry(hook.id, hook.url, payload, 0).catch((err) => {
      logger.error({ err, webhookId: hook.id }, "Webhook delivery failed after retries");
    });
  }
}

async function _deliverWithRetry(
  webhookId: number,
  url: string,
  payload: WebhookPayload,
  attempt: number
): Promise<void> {
  const db = getDb();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      // Success: reset failure count, update last_triggered_at
      db.prepare(
        "UPDATE webhooks SET failure_count = 0, last_triggered_at = datetime('now') WHERE id = ?"
      ).run(webhookId);
      logger.info({ webhookId, event: payload.event }, "Webhook delivered");
      return;
    }

    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      const delay = Math.pow(BACKOFF_BASE, attempt) * 1000; // 1s, 5s, 25s
      await new Promise((resolve) => setTimeout(resolve, delay));
      return _deliverWithRetry(webhookId, url, payload, attempt + 1);
    }

    // All retries exhausted: increment failure_count
    db.prepare("UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?").run(webhookId);

    // Check if we should auto-disable
    const row = db.prepare("SELECT failure_count FROM webhooks WHERE id = ?").get(webhookId) as
      | { failure_count: number }
      | undefined;
    if (row && row.failure_count >= AUTO_DISABLE_THRESHOLD) {
      db.prepare("UPDATE webhooks SET active = 0 WHERE id = ?").run(webhookId);
      logger.warn({ webhookId }, "Webhook auto-disabled after %d consecutive failures", AUTO_DISABLE_THRESHOLD);
    }

    logger.error({ err, webhookId, attempt }, "Webhook delivery failed");
  }
}
