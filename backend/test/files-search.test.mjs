// searchFiles: cross-agent file search, against a throwaway SQLite DB (never the live one).
// Run inside the backend image after `npm run build`:
//   docker run --rm -e DB_PATH=/tmp/fs-test.db -v "$PWD/backend/test:/app/test:ro" \
//     <backend image> node test/files-search.test.mjs
if (!process.env.DB_PATH || !process.env.DB_PATH.startsWith("/tmp/")) {
  console.error("Set DB_PATH to a file under /tmp/ (refusing to touch a real database)");
  process.exit(2);
}
const { getDb, createAgent, searchFiles } = await import("../dist/db.js");

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
}

createAgent("aaaa1111-0000-0000-0000-000000000001", "Alpha");
createAgent("bbbb2222-0000-0000-0000-000000000002", "Beta");
getDb().prepare("UPDATE agents SET status='archived' WHERE id LIKE 'bbbb2222%'").run();
const ins = getDb().prepare("INSERT INTO files (agent_id, filename, mimetype, data, size) VALUES (?, ?, ?, ?, ?)");
ins.run("aaaa1111-0000-0000-0000-000000000001", "report_final.pdf", "application/pdf", Buffer.from("x"), 1);
ins.run("aaaa1111-0000-0000-0000-000000000001", "100%_done.png", "image/png", Buffer.from("x"), 1);
ins.run("bbbb2222-0000-0000-0000-000000000002", "Screenshot_Report.png", "image/png", Buffer.from("x"), 1);
for (let i = 0; i < 5; i++) ins.run("bbbb2222-0000-0000-0000-000000000002", `log_${i}.txt`, "text/plain", Buffer.from("x"), 1);

const all = searchFiles("", 50);
ok(all.data.length === 8, "empty query lists every agent's files", all.data.length);
ok(all.data[0].id > all.data[all.data.length - 1].id, "newest first");
ok(!("data" in all.data[0]), "never returns the blob");
ok(all.data.some((r) => r.agent_title === "Beta" && r.agent_status === "archived"), "includes archived agents, with title and status");

const rep = searchFiles("report", 50).data.map((r) => r.filename).sort();
ok(JSON.stringify(rep) === JSON.stringify(["Screenshot_Report.png", "report_final.pdf"]), "partial filename, case-insensitive", rep);

ok(searchFiles("%", 50).data.length === 1, "LIKE wildcards in q are literal (% matches only the file named with %)", searchFiles("%", 50).data.length);
ok(searchFiles("lo__", 50).data.length === 0, "underscore is literal (lo__ would match log_N as a wildcard)", searchFiles("lo__", 50).data.length);

const id = all.data[3].id;
ok(searchFiles(String(id), 50).data.some((r) => r.id === id), "matches the file id");
ok(searchFiles("bbbb22", 50).data.length === 6, "matches the start of the agent id", searchFiles("bbbb22", 50).data.length);
ok(searchFiles("000000000002", 50).data.length === 0, "agent id is a prefix match, not substring");

const p1 = searchFiles("", 3);
const p2 = searchFiles("", 3, p1.next_cursor);
ok(p1.has_more && p2.data.length === 3 && p2.data[0].id < p1.data[2].id, "cursor pagination continues below the last id");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
