import { getDb } from "./db.js";
import { logger } from "./logger.js";
import path from "node:path";
import fs from "node:fs";

const BACKUP_DIR = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : "./data", "backups");
const INTERVAL_HOURS = parseInt(process.env.BACKUP_INTERVAL_HOURS || "12", 10);
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || "7", 10);

export function startBackupScheduler() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Run backup immediately, then on interval
  runBackup();
  setInterval(runBackup, INTERVAL_HOURS * 3600_000);

  // WAL checkpoint every hour
  setInterval(() => {
    try {
      getDb().pragma("wal_checkpoint(PASSIVE)");
      logger.info("WAL checkpoint completed");
    } catch (err) {
      logger.error({ err }, "WAL checkpoint failed");
    }
  }, 3600_000);
}

function runBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `agents_${timestamp}.db`);

    getDb().backup(backupPath).then(() => {
      logger.info({ backupPath }, "Database backup completed");
      cleanOldBackups();
    }).catch((err: unknown) => {
      logger.error({ err }, "Database backup failed");
    });
  } catch (err) {
    logger.error({ err }, "Database backup error");
  }
}

function cleanOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("agents_") && f.endsWith(".db"));
  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      logger.info({ file }, "Deleted old backup");
    }
  }
}
