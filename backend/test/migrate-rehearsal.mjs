// Migration rehearsal: open a COPY of a production DB with the new code's getDb() (which runs
// every migration) and report what changed in the KB tables. Never point this at a live DB.
//   docker run --rm -v <copy-dir>:/app/data -v <repo>/backend/test:/app/test:ro \
//     -e DB_PATH=/app/data/agents.db <backend-image> node test/migrate-rehearsal.mjs
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "/app/data/agents.db";
const snap = (db) => ({
  pending_ddl_has_retire: (db.prepare("SELECT sql FROM sqlite_master WHERE name='knowledge_pending'").get()?.sql ?? "").includes("'retire'"),
  pending_rows: db.prepare("SELECT COUNT(*) c FROM knowledge_pending").get().c,
  pending_by_status: db.prepare("SELECT status, COUNT(*) c FROM knowledge_pending GROUP BY status").all(),
  pending_max_id: db.prepare("SELECT MAX(id) m FROM knowledge_pending").get().m,
  pending_with_wanted: db.prepare("SELECT COUNT(*) c FROM knowledge_pending WHERE wanted_id IS NOT NULL").get().c,
  entries: db.prepare("SELECT COUNT(*) c FROM knowledge_entries").get().c,
  kb_reviews: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_reviews'").get(),
  kb_review_requests: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_review_requests'").get(),
});

const before = new Database(DB_PATH);
const b = snap(before);
before.close();

const { getDb } = await import("../dist/db.js");
const t0 = Date.now();
const db = getDb();
const ms = Date.now() - t0;
const a = snap(db);
const fk = db.pragma("foreign_key_check").length;
const integrity = db.pragma("integrity_check", { simple: true });
db.close();

// Second open: must be a no-op for the KB migration.
const db2 = new Database(DB_PATH);
const { initKnowledgeSchema } = await import("../dist/knowledge/schema.js");
initKnowledgeSchema(db2);
const c = snap(db2);
db2.close();

console.log(JSON.stringify({ before: b, after: a, after_second_init: c, migrate_ms: ms, foreign_key_violations: fk, integrity }, null, 2));
const okAll = a.pending_ddl_has_retire && a.pending_rows === b.pending_rows && a.pending_max_id === b.pending_max_id &&
  a.pending_with_wanted === b.pending_with_wanted && a.entries === b.entries && a.kb_reviews && a.kb_review_requests &&
  JSON.stringify(c) === JSON.stringify(a) && integrity === "ok";
console.log(okAll ? "MIGRATION REHEARSAL OK" : "MIGRATION REHEARSAL FAILED");
process.exit(okAll ? 0 : 1);
