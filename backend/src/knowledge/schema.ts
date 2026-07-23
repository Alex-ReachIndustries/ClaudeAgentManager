// Knowledge Hub schema: knowledge entries (approval-gated), a pending/review queue,
// people profiles (auto-updated), plus FTS5 shadow tables for keyword search.
// Vectors for semantic search live in the `embedding` BLOB columns.
import type Database from "better-sqlite3";
import { logger } from "../logger.js";

export function initKnowledgeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      category TEXT DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',            -- JSON array
      keywords TEXT NOT NULL DEFAULT '',
      systems TEXT NOT NULL DEFAULT '[]',          -- JSON array of repos/systems
      source TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected','superseded')),
      created_by_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT,
      supersedes_id INTEGER,
      related_ids TEXT NOT NULL DEFAULT '[]',      -- JSON array
      hit_count INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      embed_stale INTEGER NOT NULL DEFAULT 1       -- 1 = needs (re)embedding
    );

    CREATE TABLE IF NOT EXISTS knowledge_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'new' CHECK(kind IN ('new','edit')),
      proposed_title TEXT,
      proposed_body TEXT,
      proposed_category TEXT,
      proposed_tags TEXT,                          -- JSON array
      proposed_systems TEXT,                       -- JSON array
      proposed_source TEXT,
      proposing_agent TEXT,
      rationale TEXT DEFAULT '',
      conflict_flags TEXT NOT NULL DEFAULT '[]',   -- JSON array of {entry_id,title,note}
      review_flag INTEGER NOT NULL DEFAULT 0,      -- flagged for the human's attention
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','accepted','updated','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_note TEXT
    );

    CREATE TABLE IF NOT EXISTS people_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      aliases TEXT NOT NULL DEFAULT '[]',           -- JSON array
      role TEXT DEFAULT '',
      org TEXT DEFAULT '',
      relationships TEXT DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',             -- markdown, kept current
      facts TEXT NOT NULL DEFAULT '[]',             -- JSON array of {fact,source,at,by}
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      embedding BLOB,
      embed_stale INTEGER NOT NULL DEFAULT 1
    );

    -- Nested category tree. A category may have a parent (arbitrary depth) and its
    -- own embedding (from name + ancestor names + description) for semantic matching.
    CREATE TABLE IF NOT EXISTS kb_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES kb_categories(id) ON DELETE CASCADE,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      embedding BLOB,
      embed_stale INTEGER DEFAULT 1
    );

    -- MANY-TO-MANY article↔category. source='auto' rows come from semantic
    -- classification; source='manual' is a human/agent pin. suppressed=1 is a
    -- tombstone for an auto membership a human removed — auto must never re-add it.
    CREATE TABLE IF NOT EXISTS kb_entry_categories (
      entry_id INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES kb_categories(id) ON DELETE CASCADE,
      source TEXT DEFAULT 'auto' CHECK(source IN ('auto','manual')),
      suppressed INTEGER DEFAULT 0,
      score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(entry_id, category_id)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_entries(status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_embed_stale ON knowledge_entries(embed_stale);
    CREATE INDEX IF NOT EXISTS idx_pending_status ON knowledge_pending(status);
    CREATE INDEX IF NOT EXISTS idx_profiles_embed_stale ON people_profiles(embed_stale);
    CREATE INDEX IF NOT EXISTS idx_kb_categories_parent ON kb_categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_kb_categories_embed_stale ON kb_categories(embed_stale);
    CREATE INDEX IF NOT EXISTS idx_kb_entry_categories_cat ON kb_entry_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_kb_entry_categories_entry ON kb_entry_categories(entry_id);
  `);

  // FTS5 shadow tables (manually kept in sync by the store layer). Contentless-external
  // rowids map 1:1 to entry/profile ids.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, body, keywords, tags, tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts USING fts5(
        name, summary, facts, tokenize='porter unicode61'
      );
    `);
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Failed to create FTS5 tables (is FTS5 compiled in?)");
    throw e;
  }

  logger.info("Knowledge Hub schema ready");
}
