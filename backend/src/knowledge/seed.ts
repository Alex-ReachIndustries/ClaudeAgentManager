// One-shot seeder: import the operator's existing markdown memory into the hub.
// Sources:
//   - <HOST_HOME_MOUNT>/.claude/**/memory/*.md   (per-project auto-memory)
//   - <HOST_HOME_MOUNT>/.claude/**/CLAUDE.md      (global + project instructions)
//   - <cwd>/claudeadmin/**/*.md                   (this repo's working notes, if present)
// Each file becomes an APPROVED knowledge_entries row. We then run scanConflicts on
// it and, for anything that looks like a duplicate/contradiction, raise a review
// flag + a knowledge_pending row so the human sees it in the queue.
import fs from "node:fs";
import path from "node:path";
import { insertApprovedEntry, createProposal, countEntries } from "./store.js";
import { scanConflicts } from "./conflict.js";
import { logger } from "../logger.js";

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(full, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function collectSources(): string[] {
  const files = new Set<string>();

  const hostHome = process.env.HOST_HOME_MOUNT || "/host-home";
  const claudeDir = path.join(hostHome, ".claude");
  for (const f of walk(claudeDir)) {
    if (!f.endsWith(".md")) continue;
    const base = path.basename(f);
    if (base === "CLAUDE.md" || f.includes(`${path.sep}memory${path.sep}`)) files.add(f);
  }

  const adminDir = path.join(process.cwd(), "claudeadmin");
  for (const f of walk(adminDir)) {
    if (f.endsWith(".md")) files.add(f);
  }

  return [...files];
}

function titleFromContent(content: string, filePath: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 200);
  return path.basename(filePath).replace(/\.md$/i, "");
}

function tagsFromPath(filePath: string): string[] {
  const tags: string[] = [];
  if (filePath.includes(`${path.sep}memory${path.sep}`)) tags.push("memory");
  if (path.basename(filePath) === "CLAUDE.md") tags.push("instructions");
  if (filePath.includes("claudeadmin")) tags.push("claudeadmin");
  return tags;
}

export async function seedFromMemories(opts: { dryRun?: boolean } = {}): Promise<{ imported: number; flagged: number; files: number }> {
  const dryRun = opts.dryRun ?? false;
  const files = collectSources();
  let imported = 0;
  let flagged = 0;

  for (const file of files) {
    let content: string;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (!content.trim()) continue;

    const title = titleFromContent(content, file);
    const tags = tagsFromPath(file);

    if (dryRun) { imported++; continue; }

    const entryId = insertApprovedEntry({
      title,
      body: content.slice(0, 100000),
      source: file,
      tags,
      agent: "seed",
    });

    // Flag likely duplicates/contradictions against what's already approved.
    try {
      const conflicts = await scanConflicts({ title, body: content, tags });
      // Exclude self-match (the row we just inserted isn't embedded yet, but be safe).
      const real = conflicts.filter((c) => c.entry_id !== entryId);
      if (real.length > 0) {
        createProposal({
          kind: "edit",
          entry_id: entryId,
          agent: "seed",
          rationale: "Seeded entry flagged as a possible duplicate/contradiction of existing knowledge.",
          conflicts: real,
        });
        flagged++;
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file }, "KB seed conflict scan failed");
    }

    imported++;
  }

  logger.info({ imported, flagged, files: files.length, dryRun }, "KB seed complete");
  return { imported, flagged, files: files.length };
}
