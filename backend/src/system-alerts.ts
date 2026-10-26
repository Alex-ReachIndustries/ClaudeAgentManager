// System alerts: host-level warnings that reach the user as genuine notifications
// (Android "system-alert" SSE event, web banner, web push), never as agent chatter.
//   - fleet-silent / fleet-recovered: no agent has checked in for FLEET_SILENT_MS. The backend
//     runs in Docker, so it survives the host's agent session dying (2026-10-26: an agent
//     SIGTERMed systemd --user and the whole fleet, watchdog included, was dead for 8 hours).
//   - usage: the watchdog reads "You've used N% of your session/weekly limit" from agent panes
//     and reports it; we alert once per threshold per limit window.
import { broadcast } from "./sse.js";
import { sendPushToAll } from "./push.js";
import { getDb } from "./db.js";
import { logger } from "./logger.js";

export type SystemAlertKind = "fleet-silent" | "fleet-recovered" | "usage";
export type SystemAlertSeverity = "info" | "warning" | "critical";

export interface SystemAlert {
  id: string;
  kind: SystemAlertKind;
  severity: SystemAlertSeverity;
  title: string;
  message: string;
  created_at: string;
}

const MAX_ALERTS = 50;
const recent: SystemAlert[] = [];

export function emitSystemAlert(alert: Omit<SystemAlert, "created_at">): SystemAlert {
  const full: SystemAlert = { ...alert, created_at: new Date().toISOString() };
  recent.unshift(full);
  if (recent.length > MAX_ALERTS) recent.length = MAX_ALERTS;
  logger.warn({ alert: full }, `System alert: ${full.title}`);
  broadcast("system-alert", full);
  sendPushToAll(full.title, full.message, "/").catch((err) => logger.warn({ err }, "System alert push failed"));
  return full;
}

/** Newest first. */
export function getRecentSystemAlerts(): SystemAlert[] {
  return [...recent];
}

// ── Usage thresholds ────────────────────────────────────────────────────────────────────

export const USAGE_THRESHOLDS = [95, 99] as const;
export type UsageLimit = "session" | "weekly";

/** ISO-8601 week key, e.g. "2026-W44". */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The window a usage reading belongs to: its reset time if known, else the UTC day (session)
 *  or ISO week (weekly). Thresholds re-arm in each new window. */
export function usageWindowKey(limit: UsageLimit, resets: string | undefined, now: Date): string {
  if (resets && resets.trim()) return resets.trim().toLowerCase();
  return limit === "weekly" ? isoWeekKey(now) : now.toISOString().slice(0, 10);
}

/**
 * Pure decision: which threshold (if any) to alert for. `sent` holds keys already alerted
 * ("<limit>|<window>|<threshold>"). Only the highest crossed threshold is sent; sending 99
 * also marks 95, so a later 95 reading in the same window stays quiet.
 */
export function usageAlertDecision(
  limit: UsageLimit, percent: number, windowKey: string, sent: Set<string>,
): { threshold: number | null; markSent: string[] } {
  const crossed = USAGE_THRESHOLDS.filter((t) => percent >= t);
  if (crossed.length === 0) return { threshold: null, markSent: [] };
  const top = crossed[crossed.length - 1];
  const key = (t: number) => `${limit}|${windowKey}|${t}`;
  if (sent.has(key(top))) return { threshold: null, markSent: [] };
  return { threshold: top, markSent: crossed.map(key) };
}

// key -> when it was sent. A reset label such as "9:30am" recurs on later days, so a sent key
// only counts within the lifetime of one window (session windows are 5h, weekly 7 days).
const usageSent = new Map<string, number>();
export const USAGE_SENT_TTL_MS: Record<UsageLimit, number> = {
  session: 6 * 60 * 60_000,
  weekly: 8 * 24 * 60 * 60_000,
};

export function reportUsage(limit: UsageLimit, percent: number, resets?: string, now = new Date()): boolean {
  const nowMs = now.getTime();
  for (const [k, at] of usageSent) {
    const l = k.split("|")[0] as UsageLimit;
    if (nowMs - at >= (USAGE_SENT_TTL_MS[l] ?? USAGE_SENT_TTL_MS.weekly)) usageSent.delete(k);
  }
  const windowKey = usageWindowKey(limit, resets, now);
  const { threshold, markSent } = usageAlertDecision(limit, percent, windowKey, new Set(usageSent.keys()));
  if (threshold === null) return false;
  for (const k of markSent) usageSent.set(k, nowMs);
  const name = limit === "weekly" ? "Weekly" : "Session";
  const resetText = resets && resets.trim() ? ` (resets ${resets.trim()})` : "";
  emitSystemAlert({
    id: `usage|${limit}|${windowKey}|${threshold}`,
    kind: "usage",
    severity: threshold >= 99 ? "critical" : "warning",
    title: `${name} limit ${threshold}% used`,
    message: `Claude usage is at ${percent}% of the ${limit} limit${resetText}. Agents will pause when it hits 100%.`,
  });
  return true;
}

// ── Fleet silence ───────────────────────────────────────────────────────────────────────

export const FLEET_SILENT_MS = 15 * 60_000;
export const FLEET_SILENT_REPEAT_MS = 60 * 60_000;
export const FLEET_CHECK_INTERVAL_MS = 60_000;

export interface FleetSilenceState {
  alerted: boolean;
  lastAlertAt: number | null;
}

/**
 * Pure decision. `lastSeen` = last check-in times (ms) of live agents; `startedAt` = backend
 * start, which counts as a check-in so a restart doesn't read stale timestamps as silence.
 */
export function fleetSilenceDecision(
  lastSeen: number[], now: number, startedAt: number, state: FleetSilenceState,
  thresholdMs = FLEET_SILENT_MS, repeatMs = FLEET_SILENT_REPEAT_MS,
): { action: "none" | "silent" | "recovered"; silentMinutes: number } {
  if (lastSeen.length === 0) return { action: "none", silentMinutes: 0 };
  const newest = Math.max(startedAt, ...lastSeen);
  const silentFor = now - newest;
  const silentMinutes = Math.floor(silentFor / 60_000);
  if (silentFor >= thresholdMs) {
    if (!state.alerted || state.lastAlertAt === null || now - state.lastAlertAt >= repeatMs) {
      return { action: "silent", silentMinutes };
    }
    return { action: "none", silentMinutes };
  }
  return { action: state.alerted ? "recovered" : "none", silentMinutes };
}

/** SQLite datetime('now') text is UTC without a zone: 'YYYY-MM-DD HH:MM:SS'. */
export function parseSqliteUtc(s: string): number {
  return Date.parse(s.replace(" ", "T") + "Z");
}

const fleetState: FleetSilenceState = { alerted: false, lastAlertAt: null };

export function checkFleetSilence(startedAt: number, now = Date.now()): void {
  const rows = getDb().prepare(
    `SELECT last_update_at FROM agents WHERE status IN ('active','idle','working','waiting-for-input')`,
  ).all() as { last_update_at: string | null }[];
  const lastSeen = rows.map((r) => (r.last_update_at ? parseSqliteUtc(r.last_update_at) : NaN)).filter((n) => !Number.isNaN(n));
  const { action, silentMinutes } = fleetSilenceDecision(lastSeen, now, startedAt, fleetState);
  if (action === "silent") {
    fleetState.alerted = true;
    fleetState.lastAlertAt = now;
    emitSystemAlert({
      id: `fleet-silent|${now}`,
      kind: "fleet-silent",
      severity: "critical",
      title: "Fleet silent",
      message: `No agent has checked in for ${silentMinutes} min. The agent session may have crashed; check the host.`,
    });
  } else if (action === "recovered") {
    fleetState.alerted = false;
    fleetState.lastAlertAt = null;
    emitSystemAlert({
      id: `fleet-recovered|${now}`,
      kind: "fleet-recovered",
      severity: "info",
      title: "Fleet back online",
      message: "Agents are checking in again.",
    });
  }
}

export function startFleetSilenceMonitor(): void {
  const startedAt = Date.now();
  setInterval(() => {
    try {
      checkFleetSilence(startedAt);
    } catch (err) {
      logger.error({ err }, "Error in fleet-silence check");
    }
  }, FLEET_CHECK_INTERVAL_MS);
}
