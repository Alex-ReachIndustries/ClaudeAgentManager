// Baseline seed for a FRESH install's Knowledge Hub.
//
// Each install gets its own PRIVATE hub (no fleet sharing) — but a brand-new hub
// shouldn't be a barren void the agents ignore. On first init (empty hub) we seed a
// small set of GENERAL, shareable practices — deliberately NOT operator-specific /
// private knowledge. Top of the list is the meta-entry that teaches agents how to use
// (and feed) the hub, so the habit bootstraps itself. Agents then grow their own
// domain knowledge on top.
//
// Idempotent: only runs when the hub has zero entries, so it never touches a hub that
// already has content.
import { countEntries, insertApprovedEntry } from "./store.js";
import { logger } from "../logger.js";

interface SeedEntry { title: string; body: string; tags: string[]; systems?: string[]; }

export const BASELINE_ENTRIES: SeedEntry[] = [
  {
    title: "How to use the Knowledge Hub",
    body:
      "The Knowledge Hub is the shared store of durable, reusable knowledge for this system — practices, conventions, gotchas, and error→fix recipes. Use it on EVERY non-trivial task:\n\n" +
      "1. SEARCH FIRST. Before and during the work, run several small, targeted searches (one per topic/component/risk you're about to touch), not one catch-all. And whenever you hit an unexpected error or symptom, search it in plain words BEFORE debugging from scratch — there may already be a fix. (/kb <question>, or GET /api/kb/search?q=…)\n" +
      "2. ON A HIT: follow approved guidance and cite the [id]. Treat pending entries as unverified hints; verify volatile facts (paths, flags, commands) against the live system.\n" +
      "3. ON A MISS — or results that don't actually answer you — that's a GAP, and the rules say to fill it: log it (POST /api/kb/wanted {query, note}), get the answer (read the code / ask up the chain), then CONTRIBUTE it back so the next agent finds it (POST /api/kb/propose, citing the wanted_id). An empty or near-empty hub means MORE to contribute, not less — you are building it.\n" +
      "4. NOTING ≠ SAVING. Saying 'lesson noted' saves nothing — the lesson is lost when your context clears unless you actually POST /api/kb/propose (and cite the returned pending_id).\n" +
      "5. IMPROVE, DON'T DUPLICATE. If your knowledge is about an existing entry (fills its gap, corrects it, or would 'complement' it), EDIT that entry ({\"kind\":\"edit\",\"entry_id\":N,…}) — do not create a new/'complement'/'v2' entry that fragments the topic.\n" +
      "6. CONTRIBUTE THE RIGHT THING: what MULTIPLE agents would plausibly need (broad practices → specific gotchas), NOT one-off personal notes and NOT ephemeral status ('PR X merged', 'release shipped').\n" +
      "7. A task is not 'done' until you've recorded what you searched and what you proposed. Both consult AND feed the hub — that's how it stops the fleet repeating mistakes.",
    tags: ["knowledge-hub", "practices", "meta"],
    systems: ["knowledge-hub"],
  },
  {
    title: "Contribute durable knowledge, not status",
    body:
      "The hub holds DURABLE, reusable knowledge — practices, conventions, rules, gotchas, 'when you hit error X do Y' recipes — that another agent weeks from now would be helped by. It is NOT a status log: do not put 'PR 12 merged', 'release v3 shipped', or 'currently building Z' in it. Quick test before proposing: would a different agent, on a different day, plausibly need this? If yes, propose it. If it's ephemeral, or one-off and only useful to you, keep it in your own activity log instead.",
    tags: ["knowledge-hub", "practices", "meta"],
    systems: ["knowledge-hub"],
  },
  {
    title: "Verify against the live system, not the description",
    body:
      "Before trusting a task brief, an assumption, or an inherited belief, check the ACTUAL code / behaviour / config. Briefs go stale and are often wrong. Common traps this catches: 'the backend already supports this' (the endpoint exists but nothing calls it — a consumer with no producer); a route that's registered but shadowed by an earlier parameterized route; a 'capability' that was half-built and never actually worked. Read the real code, run the real command, hit the real endpoint, then act. Verifying is cheap; building on a false assumption is not.",
    tags: ["practices", "debugging", "verification"],
  },
  {
    title: "Branch → PR → review before merging to main",
    body:
      "Do work on a branch, never directly on main. Open a PR or hand the diff to your reviewer/manager; nothing merges to main without review. Verify the build/tests pass BEFORE pushing — a green local build is not the same as 'I pushed working code', and a push that breaks the build blocks everyone. Give shared / high-blast-radius code (launchers, auth, DB migrations, anything the whole fleet depends on) the closest review and confirm no regression to unrelated platforms. This keeps main deployable.",
    tags: ["git", "workflow", "practices"],
  },
  {
    title: "Docker hygiene — don't rebuild without cause, prune safely",
    body:
      "Only rebuild an image if you changed that service's source this session — never 'to refresh' or 'just in case'. After a build, prune dangling layers with `docker image prune -f` (safe: removes only untagged intermediates). NEVER run `docker system prune` (it removes running-service images) and NEVER prune data volumes. Before heavy ops, check `df -h /`; if space is low, prune dangling first. Rebuild the specific changed service, not the whole stack, when you can.",
    tags: ["docker", "ops", "hygiene"],
  },
];

/** Seed the baseline entries iff the hub is empty (fresh install). Idempotent + safe. */
export function seedBaselineIfEmpty(): void {
  try {
    if (countEntries() > 0) return; // existing hub — never touch it
    let n = 0;
    for (const e of BASELINE_ENTRIES) {
      insertApprovedEntry({ title: e.title, body: e.body, tags: e.tags, systems: e.systems ?? [], source: "baseline", agent: "baseline-seed" });
      n++;
    }
    logger.info({ seeded: n }, "Knowledge Hub: seeded baseline general entries into empty hub");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "KB baseline seed failed (non-fatal)");
  }
}
