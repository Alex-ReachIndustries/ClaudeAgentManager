import { getDb, getSetting, setSetting } from "./db.js";
import { logger } from "./logger.js";
import fs from "node:fs";
import path from "node:path";

export interface RetentionStats {
  agentsDeleted: number;
  updatesDeleted: number;
  messagesDeleted: number;
  filesDeleted: number;
}

interface RetentionSettings {
  retention_archive_days: number;
  retention_update_days: number;
  retention_message_days: number;
  retention_enabled: boolean;
  retention_dry_run: boolean;
}

const DEFAULTS: RetentionSettings = {
  retention_archive_days: 30,
  retention_update_days: 30,
  retention_message_days: 30,
  retention_enabled: true,
  retention_dry_run: true,
};

const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof RetentionSettings)[];

let lastRunStats: RetentionStats | null = null;
let lastRunAt: string | null = null;

function ensureDefaults(): void {
  for (const key of SETTING_KEYS) {
    const existing = getSetting(key);
    if (existing === undefined) {
      setSetting(key, JSON.stringify(DEFAULTS[key]));
    }
  }
}

export function getRetentionSettings(): RetentionSettings {
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const raw = getSetting(key);
    settings[key] = raw !== undefined ? JSON.parse(raw) : DEFAULTS[key];
  }
  return settings as unknown as RetentionSettings;
}

export function getRetentionStatus(): {
  settings: RetentionSettings;
  lastRunAt: string | null;
  lastRunStats: RetentionStats | null;
} {
  return {
    settings: getRetentionSettings(),
    lastRunAt,
    lastRunStats,
  };
}

export function runRetention(): RetentionStats {
  const db = getDb();
  const settings = getRetentionSettings();
  const dryRun = settings.retention_dry_run;
  const enabled = settings.retention_enabled;

  const stats: RetentionStats = { agentsDeleted: 0, updatesDeleted: 0, messagesDeleted: 0, filesDeleted: 0 };

  if (!enabled) {
    logger.info("Retention is disabled, skipping");
    return stats;
  }

  const prefix = dryRun ? "[DRY RUN] " : "";

  // 1. Delete archived agents older than retention_archive_days
  //    Active/working/idle/waiting agents are NEVER touched
  const archiveCutoff = `-${settings.retention_archive_days} days`;
  const oldArchivedAgents = db
    .prepare(
      "SELECT id FROM agents WHERE status = 'archived' AND last_update_at < datetime('now', ?)"
    )
    .all(archiveCutoff) as { id: string }[];

  for (const agent of oldArchivedAgents) {
    // Delete files on disk for this agent
    const filePaths = db
      .prepare("SELECT file_path FROM files WHERE agent_id = ? AND file_path IS NOT NULL")
      .all(agent.id) as { file_path: string }[];

    for (const fp of filePaths) {
      if (fp.file_path) {
        logger.info(`${prefix}Retention: deleting file ${fp.file_path}`);
        if (!dryRun) {
          try { fs.unlinkSync(fp.file_path); } catch { /* ignore */ }
        }
        stats.filesDeleted++;
      }
    }

    // Remove agent files directory
    const filesDir = path.join(process.cwd(), "data", "files", agent.id);
    if (!dryRun) {
      try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    logger.info(`${prefix}Retention: deleting archived agent ${agent.id}`);
    if (!dryRun) {
      db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
    }
    stats.agentsDeleted++;
  }

  // 2. Delete old updates (keep latest 50 per agent)
  const updateCutoff = `-${settings.retention_update_days} days`;
  const agentsWithUpdates = db
    .prepare("SELECT DISTINCT agent_id FROM updates")
    .all() as { agent_id: string }[];

  for (const { agent_id } of agentsWithUpdates) {
    const old = db
      .prepare(
        `SELECT id FROM updates
         WHERE agent_id = ? AND timestamp < datetime('now', ?)
           AND id NOT IN (
             SELECT id FROM updates WHERE agent_id = ? ORDER BY id DESC LIMIT 50
           )`
      )
      .all(agent_id, updateCutoff, agent_id) as { id: number }[];

    if (old.length > 0) {
      logger.info(`${prefix}Retention: deleting ${old.length} old updates for agent ${agent_id}`);
      if (!dryRun) {
        const ids = old.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM updates WHERE id IN (${placeholders})`).run(...ids);
      }
      stats.updatesDeleted += old.length;
    }
  }

  // 3. Delete old acknowledged messages (keep latest 20 per agent)
  const messageCutoff = `-${settings.retention_message_days} days`;
  const agentsWithMsgs = db
    .prepare("SELECT DISTINCT agent_id FROM messages")
    .all() as { agent_id: string }[];

  for (const { agent_id } of agentsWithMsgs) {
    const old = db
      .prepare(
        `SELECT id FROM messages
         WHERE agent_id = ? AND status = 'acknowledged' AND created_at < datetime('now', ?)
           AND id NOT IN (
             SELECT id FROM messages WHERE agent_id = ? ORDER BY id DESC LIMIT 20
           )`
      )
      .all(agent_id, messageCutoff, agent_id) as { id: number }[];

    if (old.length > 0) {
      logger.info(`${prefix}Retention: deleting ${old.length} old messages for agent ${agent_id}`);
      if (!dryRun) {
        const ids = old.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
      }
      stats.messagesDeleted += old.length;
    }
  }

  // 4. Clean orphaned files on disk (files directory entries with no matching DB row)
  const filesBaseDir = path.join(process.cwd(), "data", "files");
  if (fs.existsSync(filesBaseDir)) {
    const agentDirs = fs.readdirSync(filesBaseDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of agentDirs) {
      const agentExists = db.prepare("SELECT 1 FROM agents WHERE id = ?").get(dir.name);
      if (!agentExists) {
        const orphanDir = path.join(filesBaseDir, dir.name);
        const orphanFiles = fs.existsSync(orphanDir) ? fs.readdirSync(orphanDir) : [];
        logger.info(`${prefix}Retention: cleaning ${orphanFiles.length} orphaned files for deleted agent ${dir.name}`);
        if (!dryRun) {
          try { fs.rmSync(orphanDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        stats.filesDeleted += orphanFiles.length;
      }
    }
  }

  lastRunStats = stats;
  lastRunAt = new Date().toISOString();

  logger.info(
    { ...stats, dryRun },
    `${prefix}Retention run complete`
  );

  return stats;
}

export function startRetentionScheduler(): void {
  ensureDefaults();
  logger.info("Retention scheduler started (runs daily)");

  // Run once on startup (after a short delay so DB is ready)
  setTimeout(() => {
    try { runRetention(); } catch (err) { logger.error({ err }, "Retention run error"); }
  }, 5_000);

  // Run daily (24 hours)
  setInterval(() => {
    try { runRetention(); } catch (err) { logger.error({ err }, "Retention run error"); }
  }, 24 * 60 * 60 * 1000);
}
