import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','executed'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      data BLOB NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_updates_agent_id ON updates(agent_id);
    CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
    CREATE INDEX IF NOT EXISTS idx_files_agent_id ON files(agent_id);
  `);

  // Migrations — add columns safely
  try { db.exec("ALTER TABLE agents ADD COLUMN poll_delay_until TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN workspace TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN last_read_at TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE files ADD COLUMN source TEXT NOT NULL DEFAULT 'user'"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE files ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch { /* exists */ }

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

  return db;
}

// --- Prepared statement helpers ---

export function getAllAgents() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      a.*,
      (SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.status = 'pending') AS pending_message_count,
      (SELECT COUNT(*) FROM updates u WHERE u.agent_id = a.id AND (a.last_read_at IS NULL OR u.timestamp > a.last_read_at)) AS unread_update_count,
      (SELECT u.summary FROM updates u WHERE u.agent_id = a.id ORDER BY u.timestamp DESC LIMIT 1) AS latest_summary,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.agent_id = a.id) AS last_message_at
    FROM agents a
    ORDER BY a.last_update_at DESC
  `);
  return stmt.all();
}

export function getAgent(id: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      a.*,
      (SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.status = 'pending') AS pending_message_count,
      (SELECT COUNT(*) FROM updates u WHERE u.agent_id = a.id AND (a.last_read_at IS NULL OR u.timestamp > a.last_read_at)) AS unread_update_count,
      (SELECT u.summary FROM updates u WHERE u.agent_id = a.id ORDER BY u.timestamp DESC LIMIT 1) AS latest_summary,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.agent_id = a.id) AS last_message_at
    FROM agents a
    WHERE a.id = ?
  `);
  return stmt.get(id) as Record<string, unknown> | undefined;
}

export function createAgent(id: string, title: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO agents (id, title) VALUES (?, ?)
  `);
  return stmt.run(id, title);
}

export function updateAgent(
  id: string,
  fields: { title?: string; status?: string; metadata?: string; poll_delay_until?: string | null; workspace?: string; last_read_at?: string }
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
  }

  if (setClauses.length === 0) return;

  setClauses.push("last_update_at = datetime('now')");
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

export function getUpdates(agentId: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM updates WHERE agent_id = ? ORDER BY timestamp ASC
  `);
  return stmt.all(agentId);
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
        last_update_at = datetime('now')
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

  const selectPending = db.prepare(`
    SELECT * FROM messages WHERE agent_id = ? AND status = 'pending'
  `);
  const markDelivered = db.prepare(`
    UPDATE messages
    SET status = 'delivered', delivered_at = datetime('now')
    WHERE agent_id = ? AND status = 'pending'
  `);

  const transaction = db.transaction(() => {
    const messages = selectPending.all(agentId);
    markDelivered.run(agentId);
    return messages;
  });

  return transaction();
}

export function addMessage(agentId: string, content: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO messages (agent_id, content) VALUES (?, ?)
  `);
  return stmt.run(agentId, content);
}

export function acknowledgeMessages(agentId: string) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE messages
    SET status = 'acknowledged', acknowledged_at = datetime('now')
    WHERE agent_id = ? AND status = 'delivered'
  `);
  return stmt.run(agentId);
}

export function getMessages(agentId: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC
  `);
  return stmt.all(agentId);
}

export function touchAgentHeartbeat(agentId: string) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE agents SET last_update_at = datetime('now') WHERE id = ?
  `);
  return stmt.run(agentId);
}

export function archiveInactiveAgents(inactiveMinutes: number = 30): string[] {
  const db = getDb();

  // Find agents that are active/idle but haven't been heard from in > N minutes
  // Skip agents that have pending messages or unread updates
  const findInactive = db.prepare(`
    SELECT a.id FROM agents a
    WHERE a.status IN ('active', 'idle', 'working', 'waiting-for-input')
      AND a.last_update_at < datetime('now', ? || ' minutes')
      AND (SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.status = 'pending') = 0
      AND (SELECT COUNT(*) FROM updates u WHERE u.agent_id = a.id AND (a.last_read_at IS NULL OR u.timestamp > a.last_read_at)) = 0
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
  data: Buffer,
  size: number,
  source: string = "user",
  description: string = ""
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO files (agent_id, filename, mimetype, data, size, source, description) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(agentId, filename, mimetype, data, size, source, description);
}

export function getFile(agentId: string, fileId: number) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM files WHERE id = ? AND agent_id = ?
  `);
  return stmt.get(fileId, agentId) as
    | { id: number; agent_id: string; filename: string; mimetype: string; data: Buffer; size: number; created_at: string }
    | undefined;
}

export function getFilesMeta(agentId: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, agent_id, filename, mimetype, size, source, description, created_at FROM files WHERE agent_id = ? ORDER BY created_at ASC
  `);
  return stmt.all(agentId);
}
