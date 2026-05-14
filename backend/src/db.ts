import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { logger } from "./logger.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "agents.db");

  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // NORMAL is safe with WAL and avoids an fsync on every single write.
  // Full durability is preserved — worst case on power loss is losing the
  // last transaction, not corruption.
  db.pragma("synchronous = NORMAL");
  // Keep 10MB of WAL in memory before checkpointing to batch disk writes.
  db.pragma("wal_autocheckpoint = 1000");
  // 8MB page cache reduces read I/O on repeated queries.
  db.pragma("cache_size = -8000");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Agent',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','working','waiting-for-input','completed','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_update_at TEXT NOT NULL DEFAULT (datetime('now')),
      update_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','progress','diagram','error','status')),
      content TEXT NOT NULL DEFAULT '{}',
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','executed')),
      source TEXT DEFAULT 'user',
      source_agent_id TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      data BLOB,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS launch_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'new' CHECK(type IN ('new','resume','terminate','signal','input')),
      folder_path TEXT NOT NULL DEFAULT '',
      resume_agent_id TEXT,
      target_pid INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','completed','failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      claimed_at TEXT,
      completed_at TEXT,
      agent_id TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_triggered_at TEXT,
      failure_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','paused')),
      current_step INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','paused','completed','failed')),
      pm_agent_id TEXT,
      folder_path TEXT NOT NULL DEFAULT '',
      max_concurrent INTEGER DEFAULT 4,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS project_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'info',
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'unlabeled',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cost_events_agent_id ON cost_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_project_updates_project_id ON project_updates(project_id);
    CREATE INDEX IF NOT EXISTS idx_updates_agent_id ON updates(agent_id);
    CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
    CREATE INDEX IF NOT EXISTS idx_files_agent_id ON files(agent_id);
    CREATE INDEX IF NOT EXISTS idx_launch_requests_status ON launch_requests(status);
  `);

  // Helper: run a migration, silencing "duplicate column/index" but logging other failures
  const migrate = (sql: string) => {
    try {
      db!.exec(sql);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate column name") && !msg.includes("already exists")) {
        logger.warn({ sql, err: msg }, "Migration failed unexpectedly");
      }
    }
  };

  // Migrations — add columns safely
  migrate("ALTER TABLE agents ADD COLUMN poll_delay_until TEXT");
  migrate("ALTER TABLE agents ADD COLUMN workspace TEXT");
  migrate("ALTER TABLE agents ADD COLUMN last_read_at TEXT");
  migrate("ALTER TABLE files ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  migrate("ALTER TABLE files ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE agents ADD COLUMN last_activity_at TEXT");
  migrate("ALTER TABLE agents ADD COLUMN cwd TEXT");
  migrate("ALTER TABLE agents ADD COLUMN pid INTEGER");
  migrate("ALTER TABLE launch_requests ADD COLUMN target_pid INTEGER");
  // Backfill last_activity_at from last_update_at where null
  migrate("UPDATE agents SET last_activity_at = last_update_at WHERE last_activity_at IS NULL");

  // Project workflow columns on agents
  migrate("ALTER TABLE agents ADD COLUMN project_id TEXT");
  migrate("ALTER TABLE agents ADD COLUMN role TEXT");
  migrate("ALTER TABLE agents ADD COLUMN parent_agent_id TEXT");
  migrate("ALTER TABLE agents ADD COLUMN task TEXT");

  // Feature 17: Agent-to-agent messaging source columns
  migrate("ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'user'");
  migrate("ALTER TABLE messages ADD COLUMN source_agent_id TEXT");
  migrate("ALTER TABLE messages ADD COLUMN source_peer_name TEXT");

  // TOTP service tables — for agent-managed debug 2FA accounts. Per-machine
  // (each box has its own service / DB / master key). See backend/src/totp.ts
  // and ~/.claude/memory/feedback_peer_machines.md.
  migrate(`CREATE TABLE IF NOT EXISTS totp_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    issuer TEXT,
    secret_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    digits INTEGER DEFAULT 6,
    period INTEGER DEFAULT 30,
    algorithm TEXT DEFAULT 'SHA1',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by_agent TEXT,
    last_used_at TEXT,
    last_used_by_agent TEXT
  )`);
  migrate(`CREATE TABLE IF NOT EXISTS totp_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create','code_fetched','delete','rotate')),
    agent_id TEXT,
    ip TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  migrate(`CREATE INDEX IF NOT EXISTS idx_totp_audit_account ON totp_audit_log(account_name)`);
  migrate(`CREATE INDEX IF NOT EXISTS idx_totp_audit_timestamp ON totp_audit_log(timestamp DESC)`);

  // Feature 5: Computed field caching columns
  migrate("ALTER TABLE agents ADD COLUMN pending_message_count INTEGER DEFAULT 0");
  migrate("ALTER TABLE agents ADD COLUMN unread_update_count INTEGER DEFAULT 0");
  migrate("ALTER TABLE agents ADD COLUMN latest_summary TEXT");
  migrate("ALTER TABLE agents ADD COLUMN latest_message TEXT");
  migrate("ALTER TABLE agents ADD COLUMN last_message_at TEXT");

  // Feature 6: External file storage column
  migrate("ALTER TABLE files ADD COLUMN file_path TEXT");

  // Task queue enhancement: priority on messages (higher = more urgent, default 0)
  migrate("ALTER TABLE messages ADD COLUMN priority INTEGER DEFAULT 0");

  // Effort and model settings on agents
  migrate("ALTER TABLE agents ADD COLUMN effort TEXT DEFAULT 'high'");
  migrate("ALTER TABLE agents ADD COLUMN model TEXT DEFAULT 'claude-sonnet-4-6'");

  // Fixed agent name prefix — first title becomes permanent identity prefix
  migrate("ALTER TABLE agents ADD COLUMN base_title TEXT");

  // Per-agent progress tracking (0-100), updated from status/progress updates
  migrate("ALTER TABLE agents ADD COLUMN progress INTEGER DEFAULT 0");

  // PM/agent effort and model settings on projects
  migrate("ALTER TABLE projects ADD COLUMN pm_role TEXT");
  migrate("ALTER TABLE projects ADD COLUMN pm_effort TEXT DEFAULT 'high'");
  migrate("ALTER TABLE projects ADD COLUMN pm_model TEXT DEFAULT 'claude-sonnet-4-6'");
  migrate("ALTER TABLE projects ADD COLUMN agent_effort TEXT DEFAULT 'high'");
  migrate("ALTER TABLE projects ADD COLUMN agent_model TEXT DEFAULT 'claude-sonnet-4-6'");

  // Message ack content: agents must explain what they understood when acknowledging
  migrate("ALTER TABLE messages ADD COLUMN ack_content TEXT");
  migrate("ALTER TABLE agents ADD COLUMN latest_ack_content TEXT");

  // Message type: 'standard' (default) or 'ack_echo' (auto-created reply when an agent acks a message
  // sent by another agent, so the sender can see the ack content in their own inbox)
  migrate("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'standard'");

  // Message re-delivery backoff: track re-delivery count and when to next surface the message.
  // Schedule: +1m initial, then +2m, +5m, +10m, +15m, +30m, +60m, repeat 60m until acked.
  migrate("ALTER TABLE messages ADD COLUMN redeliver_count INTEGER DEFAULT 0");
  migrate("ALTER TABLE messages ADD COLUMN next_redeliver_at TEXT");
  // Backfill: give any already-delivered-unacked messages a 60s grace window before first re-ping.
  migrate("UPDATE messages SET next_redeliver_at = datetime('now', '+60 seconds') WHERE status = 'delivered' AND acknowledged_at IS NULL AND next_redeliver_at IS NULL");

  // Feature 5: Triggers for computed field caching
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS after_message_insert AFTER INSERT ON messages
      BEGIN
        UPDATE agents SET
          pending_message_count = pending_message_count + 1,
          latest_message = NEW.content,
          last_message_at = NEW.created_at
        WHERE id = NEW.agent_id;
      END
    `);
  } catch { /* exists */ }

  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS after_update_insert AFTER INSERT ON updates
      BEGIN
        UPDATE agents SET
          unread_update_count = unread_update_count + 1,
          latest_summary = COALESCE(NEW.summary, (SELECT latest_summary FROM agents WHERE id = NEW.agent_id))
        WHERE id = NEW.agent_id;
      END
    `);
  } catch { /* exists */ }

  // Feature 5: Backfill computed fields (runs once — only for agents that have data but counts are 0)
  try {
    db.exec(`
      UPDATE agents SET
        pending_message_count = (SELECT COUNT(*) FROM messages WHERE messages.agent_id = agents.id AND messages.status = 'pending'),
        unread_update_count = (SELECT COUNT(*) FROM updates WHERE updates.agent_id = agents.id AND (agents.last_read_at IS NULL OR updates.timestamp > agents.last_read_at)),
        latest_summary = (SELECT summary FROM updates WHERE updates.agent_id = agents.id ORDER BY timestamp DESC LIMIT 1),
        latest_message = (SELECT content FROM messages WHERE messages.agent_id = agents.id ORDER BY created_at DESC LIMIT 1),
        last_message_at = (SELECT MAX(created_at) FROM messages WHERE messages.agent_id = agents.id)
      WHERE EXISTS (SELECT 1 FROM messages WHERE messages.agent_id = agents.id)
         OR EXISTS (SELECT 1 FROM updates WHERE updates.agent_id = agents.id)
    `);
  } catch { /* ignore */ }

  // Migration: add 'archived' to agents status CHECK constraint
  // SQLite doesn't support ALTER CHECK, so we recreate the table if needed
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as { sql: string } | undefined;
  if (tableInfo && !tableInfo.sql.includes("'archived'")) {
    // Get existing column names to handle any user-added columns
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).join(", ");
    const extraCols = cols.filter((c) => !["id","title","status","created_at","last_update_at","update_count","metadata"].includes(c.name));
    const extraColDefs = extraCols.map((c) => {
      const colInfo = cols.find((ci) => ci.name === c.name);
      return `${c.name} TEXT`;
    }).join(",\n        ");

    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS agents_new`);
    db.exec(`
      CREATE TABLE agents_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled Agent',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','working','waiting-for-input','completed','archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_update_at TEXT NOT NULL DEFAULT (datetime('now')),
        update_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}'
        ${extraColDefs ? ", " + extraColDefs : ""}
      );
      INSERT INTO agents_new (${colNames}) SELECT ${colNames} FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'working' and 'waiting-for-input' to agents status CHECK constraint
  const agentTableNow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as { sql: string } | undefined;
  if (agentTableNow && !agentTableNow.sql.includes("'working'")) {
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS agents_new`);
    db.exec(`
      CREATE TABLE agents_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled Agent',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','working','waiting-for-input','completed','archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_update_at TEXT NOT NULL DEFAULT (datetime('now')),
        update_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        poll_delay_until TEXT,
        workspace TEXT,
        last_read_at TEXT
      );
      INSERT INTO agents_new (${colNames}) SELECT ${colNames} FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'terminate' to launch_requests type CHECK constraint
  const launchTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='launch_requests'").get() as { sql: string } | undefined;
  if (launchTableInfo && !launchTableInfo.sql.includes("'terminate'")) {
    const cols = db.prepare("PRAGMA table_info(launch_requests)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).filter((n) => n !== "target_pid").join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS launch_requests_new`);
    db.exec(`
      CREATE TABLE launch_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'new' CHECK(type IN ('new','resume','terminate')),
        folder_path TEXT NOT NULL DEFAULT '',
        resume_agent_id TEXT,
        target_pid INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','completed','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_at TEXT,
        completed_at TEXT,
        agent_id TEXT
      );
      INSERT INTO launch_requests_new (${colNames}) SELECT ${colNames} FROM launch_requests;
      DROP TABLE launch_requests;
      ALTER TABLE launch_requests_new RENAME TO launch_requests;
      CREATE INDEX IF NOT EXISTS idx_launch_requests_status ON launch_requests(status);
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'signal' and 'input' to launch_requests type CHECK constraint
  const launchTableNow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='launch_requests'").get() as { sql: string } | undefined;
  if (launchTableNow && !launchTableNow.sql.includes("'signal'")) {
    const cols = db.prepare("PRAGMA table_info(launch_requests)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS launch_requests_new`);
    db.exec(`
      CREATE TABLE launch_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'new' CHECK(type IN ('new','resume','terminate','signal','input')),
        folder_path TEXT NOT NULL DEFAULT '',
        resume_agent_id TEXT,
        target_pid INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','completed','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_at TEXT,
        completed_at TEXT,
        agent_id TEXT
      );
      INSERT INTO launch_requests_new (${colNames}) SELECT ${colNames} FROM launch_requests;
      DROP TABLE launch_requests;
      ALTER TABLE launch_requests_new RENAME TO launch_requests;
      CREATE INDEX IF NOT EXISTS idx_launch_requests_status ON launch_requests(status);
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'acknowledged' to messages status CHECK constraint
  const msgTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get() as { sql: string } | undefined;
  if (msgTableInfo && !msgTableInfo.sql.includes("'acknowledged'")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS messages_new`);
    db.exec(`
      CREATE TABLE messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        delivered_at TEXT,
        acknowledged_at TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','acknowledged','executed'))
      );
      INSERT INTO messages_new (id, agent_id, created_at, delivered_at, content, status)
        SELECT id, agent_id, created_at, delivered_at, content, status FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'relay' to updates type CHECK constraint
  const updatesTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='updates'").get() as { sql: string } | undefined;
  if (updatesTableInfo && !updatesTableInfo.sql.includes("'relay'")) {
    const cols = db.prepare("PRAGMA table_info(updates)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS updates_new`);
    db.exec(`
      CREATE TABLE updates_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','progress','diagram','error','status','relay')),
        content TEXT NOT NULL DEFAULT '{}',
        summary TEXT
      );
      INSERT INTO updates_new (${colNames}) SELECT ${colNames} FROM updates;
      DROP TABLE updates;
      ALTER TABLE updates_new RENAME TO updates;
      CREATE INDEX IF NOT EXISTS idx_updates_agent_id ON updates(agent_id);
    `);
    // Trigger was dropped with the old table — re-create it
    db.exec(`
      DROP TRIGGER IF EXISTS after_update_insert;
      CREATE TRIGGER after_update_insert AFTER INSERT ON updates
      BEGIN
        UPDATE agents SET
          unread_update_count = unread_update_count + 1,
          latest_summary = COALESCE(NEW.summary, (SELECT latest_summary FROM agents WHERE id = NEW.agent_id))
        WHERE id = NEW.agent_id;
      END
    `);
    db.pragma("foreign_keys = ON");
  }

  // Pool slot column for standby agent pool feature
  migrate("ALTER TABLE agents ADD COLUMN pool_slot INTEGER");

  // Window group for terminal tab grouping
  migrate("ALTER TABLE agents ADD COLUMN wt_window TEXT");
  migrate("ALTER TABLE launch_requests ADD COLUMN wt_window TEXT");

  // Migration: add 'standby' to agents status CHECK constraint
  // NOTE: must drop triggers referencing 'agents' BEFORE rebuilding the table, otherwise
  // SQLite 3.26+ invalidates them during ALTER TABLE RENAME (it revalidates all references).
  const agentTableStandby = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as { sql: string } | undefined;
  if (agentTableStandby && !agentTableStandby.sql.includes("'standby'")) {
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name).join(", ");
    db.pragma("foreign_keys = OFF");
    // Drop triggers that reference agents first — they'd fail validation during RENAME otherwise
    db.exec(`
      DROP TRIGGER IF EXISTS after_message_insert;
      DROP TRIGGER IF EXISTS after_update_insert;
    `);
    db.exec(`DROP TABLE IF EXISTS agents_new`);
    db.exec(`
      CREATE TABLE agents_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled Agent',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','working','waiting-for-input','completed','archived','standby')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_update_at TEXT NOT NULL DEFAULT (datetime('now')),
        update_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        poll_delay_until TEXT,
        workspace TEXT,
        last_read_at TEXT,
        last_activity_at TEXT,
        cwd TEXT,
        pid INTEGER,
        project_id TEXT,
        role TEXT,
        parent_agent_id TEXT,
        task TEXT,
        pending_message_count INTEGER DEFAULT 0,
        unread_update_count INTEGER DEFAULT 0,
        latest_summary TEXT,
        latest_message TEXT,
        last_message_at TEXT,
        effort TEXT DEFAULT 'high',
        model TEXT DEFAULT 'claude-sonnet-4-6',
        base_title TEXT,
        progress INTEGER DEFAULT 0,
        pool_slot INTEGER,
        wt_window TEXT
      );
      INSERT INTO agents_new (${colNames}) SELECT ${colNames} FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
      CREATE INDEX IF NOT EXISTS idx_updates_agent_id ON updates(agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
      CREATE INDEX IF NOT EXISTS idx_files_agent_id ON files(agent_id);
    `);
    // Recreate triggers after agents table is back in place
    db.exec(`
      CREATE TRIGGER after_message_insert AFTER INSERT ON messages
      BEGIN
        UPDATE agents SET
          pending_message_count = pending_message_count + 1,
          latest_message = NEW.content,
          last_message_at = NEW.created_at
        WHERE id = NEW.agent_id;
      END
    `);
    db.exec(`
      CREATE TRIGGER after_update_insert AFTER INSERT ON updates
      BEGIN
        UPDATE agents SET
          unread_update_count = unread_update_count + 1,
          latest_summary = COALESCE(NEW.summary, (SELECT latest_summary FROM agents WHERE id = NEW.agent_id))
        WHERE id = NEW.agent_id;
      END
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add 'terminate-resume' to launch_requests type CHECK constraint + wt_window in INSERT
  const lrTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='launch_requests'").get() as { sql: string } | undefined;
  if (lrTable && !lrTable.sql.includes("'terminate-resume'")) {
    const lrCols = db.prepare("PRAGMA table_info(launch_requests)").all() as { name: string }[];
    const lrColNames = lrCols.map((c) => c.name).join(", ");
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE IF EXISTS launch_requests_new`);
    db.exec(`
      CREATE TABLE launch_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'new' CHECK(type IN ('new','resume','terminate','signal','input','terminate-resume')),
        folder_path TEXT NOT NULL DEFAULT '',
        resume_agent_id TEXT,
        target_pid INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','completed','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_at TEXT,
        completed_at TEXT,
        agent_id TEXT,
        wt_window TEXT
      );
      INSERT INTO launch_requests_new (${lrColNames}) SELECT ${lrColNames} FROM launch_requests;
      DROP TABLE launch_requests;
      ALTER TABLE launch_requests_new RENAME TO launch_requests;
      CREATE INDEX IF NOT EXISTS idx_launch_requests_status ON launch_requests(status);
    `);
    db.pragma("foreign_keys = ON");
  }

  // Feature 6: Migrate existing BLOBs to filesystem
  migrateFilesToDisk(db);

  return db;
}

/** One-time migration: extract existing file BLOBs to disk */
function migrateFilesToDisk(db: Database.Database): void {
  try {
    const rows = db.prepare(
      "SELECT id, agent_id, filename, data FROM files WHERE data IS NOT NULL AND length(data) > 0 AND file_path IS NULL"
    ).all() as { id: number; agent_id: string; filename: string; data: Buffer }[];

    if (rows.length === 0) return;

    const updateStmt = db.prepare("UPDATE files SET file_path = ?, data = '' WHERE id = ?");

    for (const row of rows) {
      const dir = path.join(process.cwd(), "data", "files", row.agent_id);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${row.id}_${row.filename}`);
      fs.writeFileSync(filePath, row.data);
      updateStmt.run(filePath, row.id);
    }

    logger.info({ count: rows.length }, "Migrated file BLOBs to disk");
  } catch (err) {
    logger.error({ err }, "Error migrating files to disk");
  }
}

// --- Paginated result type ---

export interface PaginatedResult<T> {
  data: T[];
  next_cursor: number | string | null;
  has_more: boolean;
}

// --- Prepared statement helpers ---

export function getAllAgents(limit: number = 50, cursor?: string): PaginatedResult<Record<string, unknown>> {
  const db = getDb();
  if (cursor) {
    const stmt = db.prepare(`
      SELECT a.*, p.name as project_name FROM agents a
      LEFT JOIN projects p ON a.project_id = p.id
      WHERE a.last_update_at < ?
      ORDER BY a.last_update_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(cursor, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].last_update_at as string : null,
      has_more: rows.length === limit,
    };
  } else {
    const stmt = db.prepare(`
      SELECT a.*, p.name as project_name FROM agents a
      LEFT JOIN projects p ON a.project_id = p.id
      ORDER BY a.last_update_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].last_update_at as string : null,
      has_more: rows.length === limit,
    };
  }
}

/** Returns all non-archived pool agents (pool_slot IS NOT NULL) across all projects. */
export function getPoolAgents(): Record<string, unknown>[] {
  const db = getDb();
  return db.prepare(
    "SELECT a.*, p.name as project_name FROM agents a LEFT JOIN projects p ON a.project_id = p.id WHERE a.pool_slot IS NOT NULL AND a.status != 'archived'"
  ).all() as Record<string, unknown>[];
}

export function getAgent(id: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM agents WHERE id = ?
  `);
  return stmt.get(id) as Record<string, unknown> | undefined;
}

export function createAgent(id: string, title: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO agents (id, title, base_title) VALUES (?, ?, ?)
  `);
  return stmt.run(id, title, title);
}

export function updateAgent(
  id: string,
  fields: { title?: string; status?: string; metadata?: string; poll_delay_until?: string | null; workspace?: string; last_read_at?: string; cwd?: string; pid?: number; role?: string; task?: string; project_id?: string | null; base_title?: string; progress?: number; effort?: string; model?: string; wt_window?: string | null }
) {
  const db = getDb();

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.title !== undefined) {
    setClauses.push("title = ?");
    values.push(fields.title);
  }
  if (fields.status !== undefined) {
    setClauses.push("status = ?");
    values.push(fields.status);
  }
  if (fields.metadata !== undefined) {
    setClauses.push("metadata = ?");
    values.push(fields.metadata);
  }
  if (fields.poll_delay_until !== undefined) {
    setClauses.push("poll_delay_until = ?");
    values.push(fields.poll_delay_until);
  }
  if (fields.workspace !== undefined) {
    setClauses.push("workspace = ?");
    values.push(fields.workspace);
  }
  if (fields.last_read_at !== undefined) {
    setClauses.push("last_read_at = ?");
    values.push(fields.last_read_at);
    // Also reset unread_update_count when marking as read
    setClauses.push("unread_update_count = 0");
  }
  if (fields.cwd !== undefined) {
    setClauses.push("cwd = ?");
    values.push(fields.cwd);
  }
  if (fields.pid !== undefined) {
    setClauses.push("pid = ?");
    values.push(fields.pid);
  }
  if (fields.role !== undefined) {
    setClauses.push("role = ?");
    values.push(fields.role);
  }
  if (fields.task !== undefined) {
    setClauses.push("task = ?");
    values.push(fields.task);
  }
  if (fields.project_id !== undefined) {
    setClauses.push("project_id = ?");
    values.push(fields.project_id);
  }
  if (fields.base_title !== undefined) {
    setClauses.push("base_title = ?");
    values.push(fields.base_title);
  }
  if (fields.progress !== undefined) {
    setClauses.push("progress = ?");
    values.push(fields.progress);
  }
  if (fields.effort !== undefined) {
    setClauses.push("effort = ?");
    values.push(fields.effort);
  }
  if (fields.model !== undefined) {
    setClauses.push("model = ?");
    values.push(fields.model);
  }
  if (fields.wt_window !== undefined) {
    setClauses.push("wt_window = ?");
    values.push(fields.wt_window);
  }

  if (setClauses.length === 0) return;

  // Do NOT bump last_update_at here — it should only be updated by
  // heartbeats (touchAgentHeartbeat) and agent updates (addUpdate).
  // Updating it on every field change (e.g. marking read from the dashboard)
  // would incorrectly make the agent appear recently active.
  values.push(id);

  const sql = `UPDATE agents SET ${setClauses.join(", ")} WHERE id = ?`;
  const stmt = db.prepare(sql);
  return stmt.run(...values);
}

export function deleteAgent(id: string) {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM agents WHERE id = ?");
  return stmt.run(id);
}

export function getUpdates(agentId: string, limit: number = 100, before?: number): PaginatedResult<Record<string, unknown>> {
  const db = getDb();
  if (before) {
    const stmt = db.prepare(`
      SELECT * FROM updates WHERE agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, before, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  } else {
    const stmt = db.prepare(`
      SELECT * FROM updates WHERE agent_id = ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  }
}

export function addUpdate(
  agentId: string,
  type: string,
  content: string,
  summary?: string
) {
  const db = getDb();

  const insertUpdate = db.prepare(`
    INSERT INTO updates (agent_id, type, content, summary) VALUES (?, ?, ?, ?)
  `);
  const bumpAgent = db.prepare(`
    UPDATE agents
    SET update_count = update_count + 1,
        last_update_at = datetime('now'),
        last_activity_at = datetime('now')
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    const result = insertUpdate.run(agentId, type, content, summary ?? null);
    bumpAgent.run(agentId);
    return result;
  });

  return transaction();
}

export function getPendingMessages(agentId: string) {
  const db = getDb();

  // Exclude source='system' — these are auto-injected role reminders, not real tasks.
  // They must not consume the watcher or the agent goes deaf between real messages.
  const selectPending = db.prepare(`
    SELECT * FROM messages WHERE agent_id = ? AND status = 'pending' AND source != 'system'
    ORDER BY priority DESC, created_at ASC
  `);
  // Re-surface messages delivered to the agent but never acknowledged, subject to backoff.
  // Backoff schedule: +1m initial, then +2m, +5m, +10m, +15m, +30m, +60m (repeat).
  const selectUnacknowledged = db.prepare(`
    SELECT * FROM messages WHERE agent_id = ? AND status = 'delivered' AND acknowledged_at IS NULL
      AND source != 'system'
      AND (next_redeliver_at IS NULL OR next_redeliver_at <= datetime('now'))
    ORDER BY priority DESC, created_at ASC
  `);
  // Bump redeliver_count and schedule the next re-ping for messages just re-surfaced.
  const updateRedelivered = db.prepare(`
    UPDATE messages
    SET redeliver_count = redeliver_count + 1,
        next_redeliver_at = datetime('now', '+' || CASE redeliver_count
          WHEN 0 THEN '120'
          WHEN 1 THEN '300'
          WHEN 2 THEN '600'
          WHEN 3 THEN '900'
          WHEN 4 THEN '1800'
          ELSE '3600'
        END || ' seconds')
    WHERE agent_id = ? AND status = 'delivered' AND acknowledged_at IS NULL
      AND (next_redeliver_at IS NULL OR next_redeliver_at <= datetime('now'))
  `);
  const markDelivered = db.prepare(`
    UPDATE messages
    SET status = 'delivered', delivered_at = datetime('now'), next_redeliver_at = datetime('now', '+60 seconds')
    WHERE agent_id = ? AND status = 'pending'
  `);
  const resetPendingCount = db.prepare(`
    UPDATE agents SET pending_message_count = 0 WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    const pending = selectPending.all(agentId);
    const unacked = selectUnacknowledged.all(agentId);
    markDelivered.run(agentId);
    if (unacked.length > 0) updateRedelivered.run(agentId);
    resetPendingCount.run(agentId);
    // Combine new pending + previously-delivered-but-unacknowledged, deduped by id
    const seen = new Set<unknown>();
    const all = [...pending, ...unacked].filter(m => {
      const msg = m as Record<string, unknown>;
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
    return all;
  });

  return transaction();
}

export function addMessage(agentId: string, content: string, source: string = "user", sourceAgentId?: string, priority: number = 0, sourcePeerName?: string, type: string = "standard") {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO messages (agent_id, content, source, source_agent_id, priority, source_peer_name, type) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const touchActivity = db.prepare(`
    UPDATE agents SET last_activity_at = datetime('now') WHERE id = ?
  `);
  const transaction = db.transaction(() => {
    const result = insert.run(agentId, content, source, sourceAgentId ?? null, priority, sourcePeerName ?? null, type);
    touchActivity.run(agentId);
    return result;
  });
  return transaction();
}

// Safety-net: auto-acknowledge delivered messages that have been waiting > 5 minutes.
// Called on every update POST as a garbage-collector for agents that crashed or were
// interrupted before they could send an explicit ack. Does NOT touch recently-delivered
// messages — those require an explicit POST /messages/ack from the agent.
export function acknowledgeMessages(agentId: string) {
  const db = getDb();
  // Only auto-ack if next_redeliver_at was >5 min ago — means the agent never picked it up
  // after the backoff window passed (dead/crashed agent). Live agents keep next_redeliver_at
  // fresh on each re-delivery so they won't be incorrectly auto-acked mid-backoff.
  const ackStmt = db.prepare(`
    UPDATE messages
    SET status = 'acknowledged', acknowledged_at = datetime('now')
    WHERE agent_id = ? AND status = 'delivered' AND acknowledged_at IS NULL
      AND (next_redeliver_at IS NULL OR next_redeliver_at < datetime('now', '-300 seconds'))
  `);
  const resetCount = db.prepare(`
    UPDATE agents SET pending_message_count = 0 WHERE id = ?
  `);
  const transaction = db.transaction(() => {
    const result = ackStmt.run(agentId);
    resetCount.run(agentId);
    return result;
  });
  return transaction();
}

// Explicit acknowledgement: agent confirms it has processed specific messages by ID.
// Called from POST /agents/:id/messages/ack after the agent completes work.
// ackContent is required — agents must demonstrate understanding of the message.
// Side-effect: for any message that originated from another agent (source_agent_id set),
// auto-inserts an ack_echo message into that agent's inbox so it can see the response.
export function acknowledgeMessagesById(agentId: string, ids: number[], ackContent: string) {
  const db = getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const ackStmt = db.prepare(`
    UPDATE messages
    SET status = 'acknowledged', acknowledged_at = datetime('now'), ack_content = ?
    WHERE agent_id = ? AND id IN (${placeholders}) AND status IN ('pending', 'delivered')
  `);
  const updateAgent = db.prepare("UPDATE agents SET latest_ack_content = ? WHERE id = ?");
  const fetchSourceAgents = db.prepare(`
    SELECT DISTINCT source_agent_id FROM messages
    WHERE agent_id = ? AND id IN (${placeholders}) AND source_agent_id IS NOT NULL
  `);
  const getTitle = db.prepare("SELECT title FROM agents WHERE id = ?");
  const insertEcho = db.prepare(`
    INSERT INTO messages (agent_id, content, source, source_agent_id, priority, source_peer_name, type)
    VALUES (?, ?, 'agent', ?, 0, NULL, 'ack_echo')
  `);
  const transaction = db.transaction(() => {
    const result = ackStmt.run(ackContent, agentId, ...ids);
    if (ackContent) updateAgent.run(ackContent, agentId);

    // Echo ack back to each originating agent
    const ackingAgent = getTitle.get(agentId) as { title: string } | undefined;
    const senderName = ackingAgent?.title ?? "Agent";
    const sources = fetchSourceAgents.all(agentId, ...ids) as { source_agent_id: string }[];
    for (const { source_agent_id } of sources) {
      insertEcho.run(source_agent_id, `[ACK from ${senderName}]: ${ackContent}`, agentId);
    }

    return result;
  });
  return transaction();
}

export function getMessages(agentId: string, limit: number = 100, before?: number): PaginatedResult<Record<string, unknown>> {
  const db = getDb();
  if (before) {
    const stmt = db.prepare(`
      SELECT * FROM messages WHERE agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, before, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  } else {
    const stmt = db.prepare(`
      SELECT * FROM messages WHERE agent_id = ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  }
}

// In-memory gate: skip the DB write if we already wrote a heartbeat for this
// agent within the last 30 seconds. Polling agents hit this every 5-15s;
// without the gate every poll is an unnecessary SQLite write.
const _lastHeartbeat = new Map<string, number>();
const HEARTBEAT_THROTTLE_MS = 30_000;

export function touchAgentHeartbeat(agentId: string) {
  const now = Date.now();
  const last = _lastHeartbeat.get(agentId) ?? 0;
  if (now - last < HEARTBEAT_THROTTLE_MS) return;
  _lastHeartbeat.set(agentId, now);
  const db = getDb();
  db.prepare(`UPDATE agents SET last_update_at = datetime('now') WHERE id = ?`).run(agentId);
}

export function archiveInactiveAgents(inactiveMinutes: number = 30): string[] {
  const db = getDb();

  // Find agents that are active/idle but haven't been heard from in > N minutes
  // Skip agents that have pending messages or unread updates (using denormalized columns)
  const findInactive = db.prepare(`
    SELECT a.id FROM agents a
    WHERE a.status IN ('active', 'idle', 'working', 'waiting-for-input')
      AND a.last_update_at < datetime('now', ? || ' minutes')
      AND a.pending_message_count = 0
      AND a.unread_update_count = 0
  `);
  const archiveOne = db.prepare(`
    UPDATE agents SET status = 'archived', last_update_at = datetime('now') WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    const inactive = findInactive.all(`-${inactiveMinutes}`) as { id: string }[];
    for (const agent of inactive) {
      archiveOne.run(agent.id);
    }
    return inactive.map((a) => a.id);
  });

  return transaction();
}

export function getMessagesByStatus(agentId: string, status: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM messages WHERE agent_id = ? AND status = ? ORDER BY created_at ASC
  `);
  return stmt.all(agentId, status);
}

export function addFile(
  agentId: string,
  filename: string,
  mimetype: string,
  filePath: string,
  size: number,
  source: string = "user",
  description: string = ""
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO files (agent_id, filename, mimetype, data, size, source, description, file_path) VALUES (?, ?, ?, '', ?, ?, ?, ?)
  `);
  return stmt.run(agentId, filename, mimetype, size, source, description, filePath);
}

export function getFile(agentId: string, fileId: number) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, agent_id, filename, mimetype, size, source, description, file_path, created_at FROM files WHERE id = ? AND agent_id = ?
  `);
  return stmt.get(fileId, agentId) as
    | { id: number; agent_id: string; filename: string; mimetype: string; size: number; source: string; description: string; file_path: string | null; created_at: string }
    | undefined;
}

export function getFilesMeta(agentId: string, limit: number = 50, before?: number): PaginatedResult<Record<string, unknown>> {
  const db = getDb();
  if (before) {
    const stmt = db.prepare(`
      SELECT id, agent_id, filename, mimetype, size, source, description, file_path, created_at FROM files WHERE agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, before, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  } else {
    const stmt = db.prepare(`
      SELECT id, agent_id, filename, mimetype, size, source, description, file_path, created_at FROM files WHERE agent_id = ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(agentId, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  }
}

export function deleteAgentFiles(agentId: string): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT file_path FROM files WHERE agent_id = ? AND file_path IS NOT NULL").all(agentId) as { file_path: string }[];
  return rows.map((r) => r.file_path);
}

// --- Launch requests ---

export function createLaunchRequest(type: string, folderPath: string, resumeAgentId?: string, targetPid?: number, wtWindow?: string | null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO launch_requests (type, folder_path, resume_agent_id, target_pid, wt_window) VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(type, folderPath, resumeAgentId ?? null, targetPid ?? null, wtWindow ?? null);
  return { id: result.lastInsertRowid, type, folder_path: folderPath, resume_agent_id: resumeAgentId ?? null, target_pid: targetPid ?? null, wt_window: wtWindow ?? null, status: 'pending' };
}

export function getLaunchRequestsByStatus(status: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM launch_requests WHERE status = ? ORDER BY created_at ASC
  `);
  return stmt.all(status);
}

export function updateLaunchRequest(id: number, fields: { status?: string; agent_id?: string; claimed_at?: string; completed_at?: string }) {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) { setClauses.push("status = ?"); values.push(fields.status); }
  if (fields.agent_id !== undefined) { setClauses.push("agent_id = ?"); values.push(fields.agent_id); }
  if (fields.claimed_at !== undefined) { setClauses.push("claimed_at = ?"); values.push(fields.claimed_at); }
  if (fields.completed_at !== undefined) { setClauses.push("completed_at = ?"); values.push(fields.completed_at); }

  if (setClauses.length === 0) return;
  values.push(id);
  const sql = `UPDATE launch_requests SET ${setClauses.join(", ")} WHERE id = ?`;
  return db.prepare(sql).run(...values);
}

export function getLaunchRequest(id: number) {
  const db = getDb();
  return db.prepare("SELECT * FROM launch_requests WHERE id = ?").get(id);
}

// --- Settings ---

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

// --- Push subscriptions ---

export function addPushSubscription(endpoint: string, p256dh: string, auth: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?)"
  ).run(endpoint, p256dh, auth);
}

export function removePushSubscription(endpoint: string): void {
  const db = getDb();
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function getAllPushSubscriptions(): { endpoint: string; keys_p256dh: string; keys_auth: string }[] {
  const db = getDb();
  return db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions").all() as {
    endpoint: string;
    keys_p256dh: string;
    keys_auth: string;
  }[];
}

// --- Projects ---

export function getAllProjects(): Record<string, unknown>[] {
  const db = getDb();
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM agents WHERE project_id = p.id AND status IN ('active','working','idle','waiting-for-input')) as active_agent_count,
      (SELECT COUNT(*) FROM agents WHERE project_id = p.id) as total_agent_count
    FROM projects p
    ORDER BY p.created_at DESC
  `).all() as Record<string, unknown>[];
  return projects;
}

export function getProject(id: string): Record<string, unknown> | undefined {
  const db = getDb();
  const project = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM agents WHERE project_id = p.id AND status IN ('active','working','idle','waiting-for-input')) as active_agent_count,
      (SELECT COUNT(*) FROM agents WHERE project_id = p.id) as total_agent_count
    FROM projects p
    WHERE p.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return project;
}

export function createProject(id: string, name: string, description: string, folderPath: string, maxConcurrent: number, pmRole?: string, pmEffort?: string, pmModel?: string, agentEffort?: string, agentModel?: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO projects (id, name, description, folder_path, max_concurrent, pm_role, pm_effort, pm_model, agent_effort, agent_model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(id, name, description, folderPath, maxConcurrent, pmRole || null, pmEffort || 'high', pmModel || 'claude-sonnet-4-6', agentEffort || 'high', agentModel || 'claude-sonnet-4-6');
}

export function updateProject(
  id: string,
  fields: { name?: string; description?: string; status?: string; pm_agent_id?: string; folder_path?: string; max_concurrent?: number; started_at?: string; completed_at?: string; metadata?: string }
) {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.name !== undefined) { setClauses.push("name = ?"); values.push(fields.name); }
  if (fields.description !== undefined) { setClauses.push("description = ?"); values.push(fields.description); }
  if (fields.status !== undefined) { setClauses.push("status = ?"); values.push(fields.status); }
  if (fields.pm_agent_id !== undefined) { setClauses.push("pm_agent_id = ?"); values.push(fields.pm_agent_id); }
  if (fields.folder_path !== undefined) { setClauses.push("folder_path = ?"); values.push(fields.folder_path); }
  if (fields.max_concurrent !== undefined) { setClauses.push("max_concurrent = ?"); values.push(fields.max_concurrent); }
  if (fields.started_at !== undefined) { setClauses.push("started_at = ?"); values.push(fields.started_at); }
  if (fields.completed_at !== undefined) { setClauses.push("completed_at = ?"); values.push(fields.completed_at); }
  if (fields.metadata !== undefined) { setClauses.push("metadata = ?"); values.push(fields.metadata); }

  if (setClauses.length === 0) return;

  values.push(id);
  const sql = `UPDATE projects SET ${setClauses.join(", ")} WHERE id = ?`;
  return db.prepare(sql).run(...values);
}

export function deleteProject(id: string) {
  const db = getDb();
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getProjectUpdates(projectId: string, limit: number = 100, before?: number): PaginatedResult<Record<string, unknown>> {
  const db = getDb();
  if (before) {
    const stmt = db.prepare(`
      SELECT * FROM project_updates WHERE project_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(projectId, before, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  } else {
    const stmt = db.prepare(`
      SELECT * FROM project_updates WHERE project_id = ? ORDER BY id DESC LIMIT ?
    `);
    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return {
      data: rows,
      next_cursor: rows.length > 0 ? rows[rows.length - 1].id as number : null,
      has_more: rows.length === limit,
    };
  }
}

export function addProjectUpdate(projectId: string, type: string, content: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO project_updates (project_id, type, content) VALUES (?, ?, ?)
  `);
  return stmt.run(projectId, type, content);
}

export function getProjectAgents(projectId: string): Record<string, unknown>[] {
  const db = getDb();
  return db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[];
}

// --- Cost events ---

export function addCostEvent(agentId: string, label: string, inputTokens: number, outputTokens: number, costUsd: number) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO cost_events (agent_id, label, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(agentId, label, inputTokens, outputTokens, Math.round(costUsd * 1e6) / 1e6);
}

export function getCostEvents(agentId: string): Record<string, unknown>[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM cost_events WHERE agent_id = ? ORDER BY created_at ASC
  `).all(agentId) as Record<string, unknown>[];
}

export function getCostEventsSummary(agentId: string): Record<string, unknown>[] {
  const db = getDb();
  return db.prepare(`
    SELECT label,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      ROUND(SUM(cost_usd), 6) as cost_usd,
      COUNT(*) as event_count,
      MIN(created_at) as first_at,
      MAX(created_at) as last_at
    FROM cost_events
    WHERE agent_id = ?
    GROUP BY label
    ORDER BY MIN(created_at) ASC
  `).all(agentId) as Record<string, unknown>[];
}

export function getActiveProjectAgentCount(projectId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE project_id = ? AND status IN ('active','working','idle','waiting-for-input')"
  ).get(projectId) as { count: number };
  return row.count;
}

// ============================================================================
// TOTP service helpers
// See backend/src/totp.ts for code generation + crypto envelope.
// ============================================================================

export interface TotpAccountRow {
  id: number;
  name: string;
  issuer: string | null;
  secret_encrypted: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  digits: number;
  period: number;
  algorithm: string;
  created_at: string;
  created_by_agent: string | null;
  last_used_at: string | null;
  last_used_by_agent: string | null;
}

export function createTotpAccount(args: {
  name: string;
  secret_encrypted: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  issuer?: string | null;
  digits?: number;
  period?: number;
  algorithm?: string;
  agent_id?: string | null;
}): { ok: true } | { ok: false; reason: "duplicate" } {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO totp_accounts
      (name, issuer, secret_encrypted, iv, auth_tag, digits, period, algorithm, created_by_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      args.name,
      args.issuer ?? null,
      args.secret_encrypted,
      args.iv,
      args.auth_tag,
      args.digits ?? 6,
      args.period ?? 30,
      args.algorithm ?? "SHA1",
      args.agent_id ?? null,
    );
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE constraint failed")) return { ok: false, reason: "duplicate" };
    throw e;
  }
}

export function getTotpAccountByName(name: string): TotpAccountRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM totp_accounts WHERE name = ?`).get(name) as TotpAccountRow | undefined;
}

export function listTotpAccounts(): Omit<TotpAccountRow, "secret_encrypted" | "iv" | "auth_tag">[] {
  const db = getDb();
  return db.prepare(`SELECT id, name, issuer, digits, period, algorithm, created_at,
    created_by_agent, last_used_at, last_used_by_agent FROM totp_accounts ORDER BY name ASC`)
    .all() as Omit<TotpAccountRow, "secret_encrypted" | "iv" | "auth_tag">[];
}

export function deleteTotpAccount(name: string): boolean {
  const db = getDb();
  const r = db.prepare(`DELETE FROM totp_accounts WHERE name = ?`).run(name);
  return r.changes > 0;
}

export function markTotpUsed(name: string, agentId: string | null) {
  const db = getDb();
  db.prepare(`UPDATE totp_accounts SET last_used_at = datetime('now'), last_used_by_agent = ? WHERE name = ?`)
    .run(agentId, name);
}

export function addTotpAudit(args: {
  account_name: string;
  action: "create" | "code_fetched" | "delete" | "rotate";
  agent_id?: string | null;
  ip?: string | null;
}) {
  const db = getDb();
  db.prepare(`INSERT INTO totp_audit_log (account_name, action, agent_id, ip) VALUES (?, ?, ?, ?)`)
    .run(args.account_name, args.action, args.agent_id ?? null, args.ip ?? null);
}

export function getTotpAudit(opts: { account?: string; limit?: number }) {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  if (opts.account) {
    return db.prepare(`SELECT * FROM totp_audit_log WHERE account_name = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.account, limit);
  }
  return db.prepare(`SELECT * FROM totp_audit_log ORDER BY id DESC LIMIT ?`).all(limit);
}
