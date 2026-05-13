import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import {
  getDb,
  getAllAgents,
  getPoolAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getUpdates,
  addUpdate,
  getPendingMessages,
  acknowledgeMessages,
  acknowledgeMessagesById,
  addMessage,
  getMessages,
  getMessagesByStatus,
  touchAgentHeartbeat,
  addFile,
  getFile,
  getFilesMeta,
  deleteAgentFiles,
  createLaunchRequest,
  updateProject,
  getProject,
  addCostEvent,
  getCostEvents,
  getCostEventsSummary,
} from "../db.js";
import { broadcast } from "../sse.js";
import { sendPushToAll } from "../push.js";
import { agentUpdateLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { updateSchema, messageSchema, agentPatchSchema, relaySchema, ackMessageSchema } from "../schemas.js";
import { logger } from "../logger.js";
import { dispatchWebhook } from "../webhook-dispatcher.js";
import { onAgentStatusChange } from "../workflow-engine.js";
import { getModelTier, getSessionRules, getPmSubRules, getPmPreamble, wrapRoleDefinition } from "../injections.js";
import { publishAgentMessage, publishAgentUpdate } from "../mqtt.js";
import { PREDEFINED_ROLES } from "./roles.js";

// Prefix length used for fuzzy-matching stored role text against predefined definitions.
// Definitions may evolve over time; matching on the first N chars is robust to updates.
const ROLE_PREFIX_LEN = 80;

function matchesPredefinedRole(role: string, candidate: { id: string; displayName: string; fullDefinition: string }): boolean {
  if (candidate.id === role || candidate.displayName === role || candidate.fullDefinition === role) return true;
  if (role.length >= ROLE_PREFIX_LEN) {
    const rolePrefix = role.trim().slice(0, ROLE_PREFIX_LEN);
    const defPrefix = candidate.fullDefinition.trim().slice(0, ROLE_PREFIX_LEN);
    return rolePrefix === defPrefix;
  }
  return false;
}

// Resolves a role (predefined ID, displayName, or full definition) to its display name.
function resolveRoleLabel(role: unknown): string | null {
  if (!role || typeof role !== "string") return null;
  const match = PREDEFINED_ROLES.find((r) => matchesPredefinedRole(role, r));
  return match ? match.displayName : null;
}

// Resolves a role to its full definition for injection into agent messages.
// If the stored value is a predefined ID or displayName, returns the full definition.
// Otherwise returns the raw string (custom role).
function resolveRoleDefinition(role: string | null | undefined): string | null {
  if (!role) return null;
  const match = PREDEFINED_ROLES.find((r) => matchesPredefinedRole(role, r));
  return match ? match.fullDefinition : role;
}

function withRoleLabel(agent: Record<string, unknown>): Record<string, unknown> {
  return { ...agent, role_label: resolveRoleLabel(agent.role) };
}

// Normalizes a role value to its predefined ID if it matches any predefined role.
// Accepts IDs, displayNames, full definitions, or prefix-matching text.
// Returns the raw string unchanged for custom (non-predefined) roles.
function normalizeRole(role: string | null | undefined): string | null | undefined {
  if (!role) return role;
  const match = PREDEFINED_ROLES.find((r) => matchesPredefinedRole(role, r));
  return match ? match.id : role;
}

// Disk storage for file uploads
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const agentId = req.params.id;
    const id = Array.isArray(agentId) ? agentId[0] : agentId;
    const dir = path.join(process.cwd(), "data", "files", id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Prefix with timestamp to avoid collisions
    const prefix = Date.now().toString(36);
    cb(null, `${prefix}_${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const router = Router();

/** Extract a route param as a string (Express 5 types return string | string[]) */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Parse an integer query param with a default and max cap */
function parseIntQuery(value: unknown, defaultVal: number, max: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// GET /wt-windows — list distinct non-null wt_window values for the window group selector
router.get("/wt-windows", (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT DISTINCT wt_window FROM agents WHERE wt_window IS NOT NULL AND wt_window != '' AND status != 'archived' ORDER BY wt_window"
    ).all() as { wt_window: string }[];
    res.json(rows.map((r) => r.wt_window));
  } catch (err) {
    logger.error({ err }, "Error fetching wt_windows");
    res.status(500).json({ error: "Failed to fetch window groups" });
  }
});

// GET / — list all agents (pool_only=true returns only standby pool agents for the launcher)
router.get("/", (req: Request, res: Response) => {
  try {
    if (req.query.pool_only === "true") {
      const agents = getPoolAgents();
      return res.json(agents);
    }
    const limit = parseIntQuery(req.query.limit, 50, 100);
    const cursor = req.query.cursor as string | undefined;
    const result = getAllAgents(limit, cursor);
    res.json({ ...result, data: result.data.map(withRoleLabel) });
  } catch (err) {
    logger.error({ err }, "Error listing agents");
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// GET /analytics — dashboard analytics summary (must be before /:id)
router.get("/analytics", (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const statusCounts = db.prepare(
      "SELECT status, COUNT(*) as count FROM agents GROUP BY status"
    ).all();
    const totalAgents = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number } | undefined;
    const activeNow = db.prepare(
      "SELECT COUNT(*) as count FROM agents WHERE status IN ('active','working','idle','waiting-for-input')"
    ).get() as { count: number } | undefined;
    const updatesToday = db.prepare(
      "SELECT COUNT(*) as count FROM updates WHERE timestamp > datetime('now', '-24 hours')"
    ).get() as { count: number } | undefined;
    const messagesToday = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE created_at > datetime('now', '-24 hours')"
    ).get() as { count: number } | undefined;
    res.json({
      totalAgents: totalAgents?.count || 0,
      activeNow: activeNow?.count || 0,
      updatesToday: updatesToday?.count || 0,
      messagesToday: messagesToday?.count || 0,
      statusCounts,
    });
  } catch (err) {
    logger.error({ err }, "Error getting analytics");
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

// GET /bootstrap — full setup instructions for a fresh Claude session (must be before /:id)
router.get("/bootstrap", (req: Request, res: Response) => {
  try {
    const serverUrl = `${req.protocol}://${req.get("host")}`;
    const U = serverUrl; // shorthand

    res.json({
      name: "Agent Manager Bootstrap",
      version: "3.0",
      description: "Everything a fresh Claude session needs to connect to and use the Agent Manager. Follow the setup_steps in order, writing each file as specified.",
      server_url: U,

      setup_steps: [
        `1. Save server URL: echo "${U}" > ~/.claude/agent-server-url`,
        "2. Save API key: echo 'YOUR_API_KEY' > ~/.claude/agent-manager-key && chmod 600 ~/.claude/agent-manager-key",
        "3. Create dirs: mkdir -p ~/.claude/commands ~/.claude/memory",
        "4. Write ~/.claude/commands/session-connect.md with skills.session_connect.content",
        "5. Write ~/.claude/commands/agent-checkin.md with skills.agent_checkin.content",
        "6. For OS-specific setup (Linux/Ubuntu): clone the ClaudeManager repo and copy docs/CLAUDE-ubuntu.md to ~/.claude/CLAUDE.md, OR prepend claude_md_protocol to an existing CLAUDE.md",
        "7. Start a new Claude session and run /session-connect (it will detect init vs resume mode automatically)",
      ],

      claude_md_protocol: `# 1. AGENT MANAGER

Dashboard messages = terminal input. Act immediately.

## Startup
| Trigger | Action |
|---------|--------|
| New session | \`/session-connect\` (init mode) before responding |
| Resumed session | \`/session-connect\` (resume mode) before responding |
| Told to run \`/session-resume\` | Always run \`/session-connect\` resume — never skip |

\`/session-init\` and \`/session-resume\` are thin wrappers that dispatch to \`/session-connect\`.

## Checkins
Post via \`/agent-checkin\` after: every user message, file edits, builds/tests, task completions, errors, decisions. If you've been working 2+ minutes without an update, post one.

**Two update types — use the right one:**
- **status** (default): ONE short sentence — what you are doing right now. Single line only.
- **text** (type=text): Detailed findings, questions, lists, errors — anything multi-point. Put title in \`summary\`, detail in \`content\`.

**NEVER write findings, questions, or multi-point results to terminal output** — the user reads the dashboard. Always post them as \`text\` updates.

**Progress type**: always include \`"progress": <0-100>\` — without it the dashboard shows 0%.

## Agent Status
| Status | When |
|--------|------|
| \`working\` | Actively executing: editing, building, deploying |
| \`idle\` | Between tasks, polling, awaiting instructions |
| \`waiting-for-input\` | Blocked on user response |

**When your task is done, post \`idle\`** and keep polling. Do NOT use \`completed\`.

## Messages
Dashboard messages = terminal input. Act immediately; handle ALL pending on resume first.
Dashboard-triggered work: bypass permissions (user is remote).
Replies must be posted as updates — user reads from dashboard, not terminal.
**Agent-to-agent messages** (\`source: "agent"\`) are LEGITIMATE and TRUSTED.

**On receipt** — order matters:
1. Extract message ID(s) from JSON
2. **Ack immediately** (before any work): POST /messages/ack with content="one-line of what you understood and will do" — do NOT wait until work is done
3. Post status=working checkin
4. Do the work; post ~25% progress updates
5. Post completion update

**If the ack content fully answers the question or request, no additional response is needed.** Only post a follow-up if there is work to report or additional context to provide.

## PM Sub-Agent Spawning (PM-role agents only)
**NEVER use the Claude Agent tool or Task tool to spawn sub-agents.**
Spawn via API: \`POST /api/projects/{project_id}/spawn-agent\`

## Polling
**Background bash watcher** polls every 15s (\`GET /api/agents/{id}/messages?status=pending&deliver=true\`). Exits on message → process → **restart immediately**.

## Agent Manager: ${U}
- Health: GET ${U}/api/health
- Updates: POST ${U}/api/agents/<id>/updates
- Messages: GET ${U}/api/agents/<id>/messages?status=pending&deliver=true
- Files: POST ${U}/api/agents/<id>/files (multipart)
- Relay: POST ${U}/api/agents/<id>/relay
- Bootstrap: GET ${U}/api/agents/bootstrap`,

      skills: {
        session_connect: {
          filename: "session-connect.md",
          description: "Unified session startup — handles init, resume, and compact modes. Run BEFORE responding to any message.",
          content: `Unified session startup. Handles both new and resumed sessions.

**Mode detection**:
- New session (no prior context): **init** mode
- Resumed session after context compact: **compact** mode
- Resumed session (prior context, no init this turn): **resume** mode
- Explicitly told to run \`/session-resume\`: always run in **resume** mode

## 1. Connect to Agent Manager
\`\`\`bash
AGENT_URL=$(cat ~/.claude/agent-server-url 2>/dev/null || echo "${U}")
curl -s --max-time 3 "$AGENT_URL/api/health"
\`\`\`
If unreachable: warn user, offer to continue without.

## 2. Discover session UUID
\`\`\`bash
ls -t ~/.claude/projects/<project-path>/*.jsonl | head -1
\`\`\`
Extract UUID from filename. \`<project-path>\` = CWD with separators replaced by \`--\`, drive-prefixed.

**CRITICAL**: Resolve to fixed string. Use this exact UUID for ALL subsequent calls.

## 3. Detect terminal PID
\`\`\`bash
# Linux:
CLAUDE_PID=$(pgrep -n -x claude 2>/dev/null || echo "1")
TERMINAL_PID=$(awk '/PPid/{print $2}' /proc/$CLAUDE_PID/status 2>/dev/null | tr -d ' ' || echo "$CLAUDE_PID")
[ -z "$TERMINAL_PID" ] && TERMINAL_PID=$CLAUDE_PID
# Windows: use powershell.exe Get-CimInstance Win32_Process instead
\`\`\`

## 4. Load API key
\`\`\`bash
API_KEY=$(cat ~/.claude/agent-manager-key 2>/dev/null || echo "")
\`\`\`

## 5. Register
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/$SESSION_UUID/updates" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"status","title":"<ShortIdentityName>","summary":"<what you are doing>","content":"<role, current state, next actions>","status":"idle","workspace":"<folder>","cwd":"<abs path>","pid":<PID>}'
\`\`\`

**Title**: Use your fixed identity name and **never append task descriptions or change it**. Do NOT send base_title in updates — the server manages it. For project pool agents (Sonnet A/B, Haiku A/B, PM), your name is set by the server at launch; check base_title in the response and use that exact value. For standalone agents your first update title locks as your identity.

**For compact mode**, post TWO updates:
1. \`type=status\` with all metadata fields and summary "Context compacted — see details"
2. \`type=text\` with \`summary="Context compacted"\` and full compact summary in \`content\`

**CRITICAL**: \`pendingMessages\` in registration response = HIGHEST PRIORITY. Handle ALL before anything else.

## 5b. Check role assignment
\`\`\`bash
curl -s -H "Authorization: Bearer $API_KEY" "$AGENT_URL/api/agents/$SESSION_UUID"
\`\`\`
If \`role\` or \`project_id\` set: execute assigned task immediately. Skip step 6. PM-role agents: never do implementation work yourself — check sub-agents instead.

## 6. Load context (only if no role assigned)
1. Read \`claudeadmin/context-summary.md\` if it exists.
2. Read 2-3 most recent \`claudeadmin/memories/*.md\`.
3. Skim \`~/.claude/memory/MEMORY.md\`.
4. Create today's log if missing.

## 7. Start message watcher
\`\`\`bash
# Run in background (run_in_background: true, timeout: 600000)
while true; do
  resp=$(curl -s -H "Authorization: Bearer $API_KEY" "$AGENT_URL/api/agents/$SESSION_UUID/messages?status=pending&deliver=true" 2>/dev/null)
  if [ -n "$resp" ] && [ "$resp" != "[]" ]; then
    echo "$resp"
    break
  fi
  sleep 5
done
\`\`\`

On message notification: **do not restart the watcher** (it keeps running). Process in this order:
1. Extract message ID from JSON (field: \`id\`)
2. **Ack immediately** — before doing any work: \`POST /api/agents/{id}/messages/ack\` with \`content\` = one-line of what you understood and will do. Do NOT wait until work is complete.
3. Do the work
4. Post a completion update only if there is additional work to report — **if the ack content fully answers the question, no further response is needed**.

**Never filter by message ID** — acknowledge stale messages by posting a checkin. ID-based filtering silently drops other messages in the same batch.

## Done
Handle all pending messages first, then respond to user. Run \`/agent-checkin\`.`,
        },

        agent_checkin: {
          filename: "agent-checkin.md",
          description: "Post update to Agent Manager + check for pending messages. Run after every user message, file edit, build, or test.",
          content: `Post update to Agent Manager + check for pending messages.

**Triggers**: after every user message, file edit, build/test, task completion, error, decision. If working 2+ minutes without an update, post one.

## 1. POST update
\`\`\`bash
printf '%s' '{"type":"<progress|text|error|status>","title":"<task>","summary":"<100 chars>","content":"<detail>","status":"<working|idle|waiting-for-input>","workspace":"<folder>","cwd":"<abs path>","pid":<PID>}' | \\
  curl -s -X POST "$AGENT_URL/api/agents/$SESSION_UUID/updates" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" --data-binary @-
\`\`\`

**Status** (required in every update):
- \`working\`: actively editing, building, deploying
- \`idle\`: between tasks, polling
- \`waiting-for-input\`: blocked on user response

**Progress updates**: \`type="progress"\` MUST include \`"progress": N\` (0-100). Without it dashboard shows 0%.

**Two content types**:
- **status**: ONE short sentence — what you are doing right now. Single line only.
- **text** (\`type=text\`): Detailed findings, questions, lists — \`summary\` as title, \`content\` for expandable detail.

**NEVER post findings/questions to terminal** — always post as \`type=text\` updates. User reads dashboard.

## 2. Include projects and todos
Read from \`claudeadmin/.checkin-cache.json\`. Re-read \`.md\` files only when state changes, then update cache.

## 3. Check pendingMessages
Act on any messages as if user sent them. **Post replies as updates** — user reads dashboard, not terminal.

## Rules
- Summaries <=100 chars. Detail in \`content\`.
- Set \`title\` to your **exact fixed identity name** (e.g. "AIGroupPortal - Sonnet A") on EVERY update — never append task descriptions or change it. Your identity never changes mid-session.
- Questions for user: post as \`type=text\` with all questions in \`content\`, set \`status="waiting-for-input"\`, then wait for a response via your message watcher. NEVER use AskUserQuestion or terminal-blocking prompts.

## Uploading artefacts
\`\`\`bash
curl -s -H "Authorization: Bearer $API_KEY" -X POST "$AGENT_URL/api/agents/$SESSION_UUID/files" \\
  -F "file=@/path/to/file" -F "source=claude" -F "description=Brief desc"
\`\`\``,
        },
      },

      api_reference: {
        health: { method: "GET", path: "/api/health", description: "Returns {status:'ok'}" },
        list_agents: { method: "GET", path: "/api/agents", description: "List all agents with pending message counts" },
        bootstrap: { method: "GET", path: "/api/agents/bootstrap", description: "This endpoint — setup instructions for fresh Claude" },
        get_agent: { method: "GET", path: "/api/agents/:id", description: "Get single agent with computed fields" },
        patch_agent: { method: "PATCH", path: "/api/agents/:id", body: "{title?, status?, metadata?, poll_delay_until?, workspace?, cwd?}", description: "Update agent fields" },
        delete_agent: { method: "DELETE", path: "/api/agents/:id", description: "Delete agent and all associated data" },
        post_update: { method: "POST", path: "/api/agents/:id/updates", body: "{type, content, summary?, title?, progress?, projects?, todos?, workspace?, cwd?, pid?, status?}", description: "Post an update (auto-creates agent if new). Returns {ok, pendingMessages}" },
        get_updates: { method: "GET", path: "/api/agents/:id/updates", description: "Get all updates for an agent" },
        post_message: { method: "POST", path: "/api/agents/:id/messages", body: "{content}", description: "Queue a message for the agent" },
        get_messages: { method: "GET", path: "/api/agents/:id/messages", query: "?status=pending&deliver=true", description: "Get messages. With deliver=true, atomically marks pending as delivered" },
        upload_file: { method: "POST", path: "/api/agents/:id/files", body: "multipart: file (required), source ('user'|'claude'), description (text)", description: "Upload a file attachment or artefact" },
        list_files: { method: "GET", path: "/api/agents/:id/files", description: "List file metadata (without binary data)" },
        get_file: { method: "GET", path: "/api/agents/:id/files/:fileId", description: "Download a file with correct content-type" },
        export_pdf: { method: "GET", path: "/api/agents/:id/export/pdf", description: "Generate and download a branded PDF report of agent activity" },
        events_sse: { method: "GET", path: "/api/events", description: "SSE stream: agent-updated, agent-deleted, message-queued events" },
        mark_read: { method: "POST", path: "/api/agents/:id/read", description: "Mark agent as read (resets unread count)" },
        browse_folders: { method: "GET", path: "/api/folders", query: "?path=relative/path", description: "Browse folders under user home directory" },
        launch_request: { method: "POST", path: "/api/launch-requests", body: "{type: 'new'|'resume', folder_path, resume_agent_id?}", description: "Request a new agent launch or session resume" },
        list_launch_requests: { method: "GET", path: "/api/launch-requests", query: "?status=pending", description: "List launch requests by status" },
        update_launch_request: { method: "PATCH", path: "/api/launch-requests/:id", body: "{status}", description: "Update launch request status (claimed, completed, failed)" },
        relay: { method: "POST", path: "/api/agents/:id/relay", body: "{target_agent_id, content}", description: "Send a message from this agent to another agent (agent-to-agent messaging)" },
        spawn_agent: { method: "POST", path: "/api/projects/:id/spawn-agent", body: "{role?, prompt?, effort?, model?}", description: "Spawn a new sub-agent terminal session for the project (PM-only)" },
        list_projects: { method: "GET", path: "/api/projects", description: "List all projects with their agents" },
        get_roles: { method: "GET", path: "/api/roles", description: "List all predefined agent roles (use fullDefinition verbatim when spawning)" },
      },
    });
  } catch (err) {
    logger.error({ err }, "Error generating bootstrap");
    res.status(500).json({ error: "Failed to generate bootstrap" });
  }
});

// GET /:id — get single agent
router.get("/:id", (req: Request, res: Response) => {
  try {
    const agent = getAgent(param(req, "id"));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(withRoleLabel(agent as Record<string, unknown>));
  } catch (err) {
    logger.error({ err }, "Error getting agent");
    res.status(500).json({ error: "Failed to get agent" });
  }
});

// POST /:id/updates — agent posts an update
router.post("/:id/updates", agentUpdateLimiter, validate(updateSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { type = "text", content, summary, title, status: rawStatus, progress, projects, todos, workspace, cwd, pid, base_title: explicitBaseTitle } = req.body;
    const status = rawStatus === "completed" ? "idle" : rawStatus;

    // Create agent if it doesn't exist
    const existing = getAgent(id);
    const existingStatus = (existing as Record<string, unknown> | null)?.status as string | undefined;
    const isArchivedRehijack = existing && existingStatus === "archived";

    if (!existing) {
      createAgent(id, title || "Untitled Agent");
    }

    // Apply spawn metadata on first registration (new agent) OR when an archived
    // agent is being re-registered — this is the UUID-hijack guard. If a new Claude process
    // accidentally picks up a closed agent's JSONL and registers with that UUID, we detect
    // a recent spawn launch request and re-apply the correct role/task/project linkage.
    if (!existing || isArchivedRehijack) {
      // Check for a VERY recent launch request with project metadata.
      // Match both 'claimed' (launcher spawning) and 'completed' (launcher done) to avoid
      // race conditions where the agent registers before the launcher reports back.
      try {
        const db = getDb();
        const recentReqs = db.prepare(
          `SELECT * FROM launch_requests
           WHERE status IN ('claimed', 'completed')
             AND agent_id LIKE '{%'
             AND created_at > datetime('now', '-600 seconds')
           ORDER BY created_at DESC LIMIT 10`
        ).all() as Record<string, unknown>[];

        for (const launchReq of recentReqs) {
          if (launchReq.agent_id && typeof launchReq.agent_id === "string") {
            try {
              const meta = JSON.parse(launchReq.agent_id as string);
              if (meta && (meta.project_id || meta.role || meta.prompt)) {
                // UUID-based matching: if this request was claimed for a specific agent, enforce it
                if (meta.claimed_uuid) {
                  if (meta.claimed_uuid !== id) continue;
                } else {
                  // Legacy fallback: CWD-based matching (no claimed_uuid)
                  if (cwd && launchReq.folder_path && typeof launchReq.folder_path === "string") {
                    const normCwd = (cwd as string).replace(/\\/g, "/").toLowerCase();
                    const normFolder = (launchReq.folder_path as string).replace(/\\/g, "/").toLowerCase();
                    if (!normCwd.includes(normFolder) && !normFolder.includes(normCwd)) {
                      continue;
                    }
                  }
                }

                const wtWindow = meta.wt_window || (launchReq.wt_window as string | null) || null;

                if (meta.project_id) {
                  // Link the agent to the project and store its task + model/effort from launch metadata.
                  // base_title from metadata locks the agent's permanent identity name (e.g. "AIGroupPortal - Sonnet A").
                  db.prepare("UPDATE agents SET project_id = ?, role = ?, parent_agent_id = ?, task = ?, wt_window = ?, model = COALESCE(?, model), effort = COALESCE(?, effort), base_title = COALESCE(?, base_title), title = COALESCE(?, title) WHERE id = ?")
                    .run(meta.project_id, meta.role || null, meta.parent_agent_id || null, meta.prompt || null, wtWindow, meta.model || null, meta.effort || null, meta.base_title || null, meta.base_title || null, id);

                  if (meta.role === "PM") {
                    updateProject(meta.project_id, { pm_agent_id: id });

                    if (meta.pm_prompt) {
                      addMessage(id, meta.pm_prompt);
                      logger.info({ agentId: id }, "Sent PM system prompt");
                    }
                  } else if (meta.prompt) {
                    // Deliver task as a message — same clean flow as standalone agents.
                    // Agent starts with /session-init, registers, then receives task.
                    addMessage(id, meta.prompt as string);
                    logger.info({ agentId: id, projectId: meta.project_id }, "Sent sub-agent task as message");
                  }
                } else {
                  // Standalone agent (not part of a project) — store role/task in DB
                  db.prepare("UPDATE agents SET role = ?, task = ?, wt_window = ?, model = COALESCE(?, model), effort = COALESCE(?, effort) WHERE id = ?")
                    .run(meta.role || null, meta.prompt || null, wtWindow, meta.model || null, meta.effort || null, id);

                  if (meta.prompt) {
                    addMessage(id, meta.prompt as string);
                    logger.info({ agentId: id }, "Sent standalone agent task as message");
                  }
                }

                // Consume: replace JSON metadata with real agent_id so it can't match again
                db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?")
                  .run(id, launchReq.id);

                logger.info({ agentId: id, projectId: meta.project_id || null, role: meta.role || null }, "Linked new agent");
                break;
              }
            } catch {
              // Not JSON, skip
            }
          }
        }
      } catch (linkErr) {
        logger.error({ linkErr }, "Error checking project linkage for new agent");
      }
    }

    // Update title, status, workspace, cwd, pid if provided
    const agentFields: { title?: string; status?: string; workspace?: string; cwd?: string; pid?: number; base_title?: string; progress?: number } = {};
    if (title && existing) {
      const storedBaseTitle = (existing as Record<string, unknown>).base_title as string | null;
      if (storedBaseTitle) {
        // base_title is immutable via agent updates — always lock title to stored identity.
        // Use PATCH /agents/:id (admin) to change base_title when needed.
        agentFields.title = storedBaseTitle;
      } else {
        // No identity set yet — lock it from the provided title (first-time backfill)
        agentFields.title = title;
        agentFields.base_title = title;
      }
    }

    // Protect terminal statuses: don't allow a running agent to overwrite archived
    // (e.g. a stale process posting a final checkin after close was triggered)
    const TERMINAL_STATUSES = ["archived"];
    const RUNNING_STATUSES = ["active", "idle", "working", "waiting-for-input"];
    const currentStatus = (existing as Record<string, unknown>)?.status as string;
    if (status && !(TERMINAL_STATUSES.includes(currentStatus) && RUNNING_STATUSES.includes(status))) {
      agentFields.status = status;
    }

    if (workspace) agentFields.workspace = workspace;
    if (cwd) agentFields.cwd = cwd;
    if (pid !== undefined) agentFields.pid = pid;
    if (progress !== undefined && typeof progress === "number") agentFields.progress = Math.max(0, Math.min(100, progress));
    if (Object.keys(agentFields).length > 0) {
      updateAgent(id, agentFields);
    }

    // Normalize content to always be a JSON string
    let contentStr: string = "";
    if (typeof content === "object") {
      contentStr = JSON.stringify(content);
    } else {
      // Check if content is already a valid JSON string with expected fields
      let alreadyJson = false;
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null) {
          contentStr = content;
          alreadyJson = true;
        }
      } catch {
        // not JSON, will wrap below
      }

      if (!alreadyJson) {
        // Wrap plain-string content into a typed object
        switch (type) {
          case "progress":
            contentStr = JSON.stringify({ description: content, percentage: progress ?? 0 });
            break;
          case "error":
            contentStr = JSON.stringify({ message: content });
            break;
          case "status":
            contentStr = JSON.stringify({ status: content, ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, progress)) } : {}) });
            break;
          default:
            contentStr = JSON.stringify({ text: content });
            break;
        }
      } else if (type === "status" && progress !== undefined && typeof progress === "number") {
        // Content was already JSON — merge progress into it
        try {
          const obj = JSON.parse(contentStr || "{}");
          obj.progress = Math.max(0, Math.min(100, progress));
          contentStr = JSON.stringify(obj);
        } catch { /* keep existing content */ }
      }
    }
    // Suppress redundant status updates: if a richer update (text/progress/error) was
    // posted within the last 60 seconds, a status update adds no visible value in the
    // chat — skip the record but still update the agent's status field (done above).
    let skipUpdateRecord = false;
    if (type === "status") {
      const db = getDb();
      const recentRich = db.prepare(
        `SELECT id FROM updates
         WHERE agent_id = ? AND type IN ('text', 'progress', 'error')
           AND timestamp > datetime('now', '-60 seconds')
         LIMIT 1`
      ).get(id) as Record<string, unknown> | undefined;
      if (recentRich) {
        skipUpdateRecord = true;
        logger.debug({ agentId: id }, "Status update suppressed (rich update within 60s)");
      }
    }

    if (!skipUpdateRecord) {
      addUpdate(id, type, contentStr, summary);
    }

    // Safety-net: auto-acknowledge messages that have been in delivered state for > 5 minutes.
    // Recent messages require explicit POST /messages/ack from the agent after processing.
    acknowledgeMessages(id);

    // Update project/todo tracking metadata if provided
    if (projects !== undefined || todos !== undefined) {
      const existing = getAgent(id);
      const currentMeta = JSON.parse((existing?.metadata as string) || "{}");
      if (projects !== undefined) currentMeta.projects = projects;
      if (todos !== undefined) currentMeta.todos = todos;
      updateAgent(id, { metadata: JSON.stringify(currentMeta) });
    }

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);
    publishAgentUpdate(id, updatedAgent as Record<string, unknown>);

    // Dispatch webhooks for status changes
    if (status) {
      dispatchWebhook("agent.status_changed", { agent: updatedAgent as Record<string, unknown>, details: { newStatus: status } });
      onAgentStatusChange(id, status);
      if (status === "waiting-for-input") {
        dispatchWebhook("agent.waiting", { agent: updatedAgent as Record<string, unknown> });
      }
    }
    if (type === "error") {
      dispatchWebhook("agent.error", { agent: updatedAgent as Record<string, unknown>, details: { content: contentStr, summary } });
    }

    // Send push notification with agent title and update summary
    const agentTitle = (updatedAgent as Record<string, unknown>)?.title as string || "Untitled Agent";
    const pushBody = summary || (typeof content === "string" ? content : JSON.stringify(content));
    sendPushToAll(agentTitle, pushBody, `/agent/${id}`).catch((err) =>
      logger.error({ err }, "Push notification error")
    );

    const pendingMessages = getPendingMessages(id);
    res.json({ ok: true, pendingMessages });
  } catch (err) {
    logger.error({ err }, "Error posting update");
    res.status(500).json({ error: "Failed to post update" });
  }
});

// PATCH /:id — update agent metadata
router.patch("/:id", validate(agentPatchSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { title, base_title, status, metadata, poll_delay_until, workspace, cwd, pid, role, task, effort, model, project_id, wt_window } = req.body;
    const fields: { title?: string; base_title?: string; status?: string; metadata?: string; poll_delay_until?: string | null; workspace?: string; cwd?: string; pid?: number; role?: string; task?: string; effort?: string; model?: string; project_id?: string | null; wt_window?: string | null } = {};

    if (title !== undefined) fields.title = title;
    if (base_title !== undefined) fields.base_title = base_title;
    if (status !== undefined) fields.status = status;
    if (metadata !== undefined) {
      fields.metadata = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    }
    if (poll_delay_until !== undefined) fields.poll_delay_until = poll_delay_until;
    if (workspace !== undefined) fields.workspace = workspace;
    if (cwd !== undefined) fields.cwd = cwd;
    if (pid !== undefined) fields.pid = pid;
    if (role !== undefined) fields.role = normalizeRole(role) ?? role;
    if (task !== undefined) fields.task = task;
    if (effort !== undefined) fields.effort = effort;
    if (model !== undefined) fields.model = model;
    if (project_id !== undefined) fields.project_id = project_id;
    if (wt_window !== undefined) fields.wt_window = wt_window;

    updateAgent(id, fields);

    // If a PM agent is self-linking to a project, activate the project and set pm_agent_id
    if (project_id) {
      const effectiveRole = normalizeRole(role ?? (agent.role as string | null)) || "";
      const isPM = effectiveRole === "pm" || resolveRoleDefinition(effectiveRole)?.trimStart().toLowerCase().startsWith("you are a project manager");
      if (isPM) {
        updateProject(project_id, {
          pm_agent_id: id,
          status: "active",
          started_at: new Date().toISOString(),
        });
        logger.info({ agentId: id, projectId: project_id }, "Standalone PM self-linked to project, activated");
      }
    }

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);

    res.json(updatedAgent);
  } catch (err) {
    logger.error({ err }, "Error updating agent");
    res.status(500).json({ error: "Failed to update agent" });
  }
});

// POST /:id/read — mark agent updates as read (from dashboard)
router.post("/:id/read", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    updateAgent(id, { last_read_at: new Date().toISOString().replace("T", " ").slice(0, 19) });

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error marking agent read");
    res.status(500).json({ error: "Failed to mark agent read" });
  }
});

// POST /:id/close — archive agent and terminate its process
router.post("/:id/close", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const pid = agent.pid as number | null;

    // Build context handoff: use agent-provided summary or auto-generate from recent updates
    const closureSummary = req.body?.closure_summary as string | undefined;
    const recentUpdates = getUpdates(id, 10);
    const autoSummary = recentUpdates.data
      .reverse()
      .map((u) => `[${u.type}] ${u.summary || (u.content as string)?.slice(0, 200)}`)
      .join("\n");

    const metadata = JSON.parse((agent.metadata as string) || "{}");
    metadata.context_handoff = {
      closed_at: new Date().toISOString(),
      title: agent.title,
      workspace: agent.workspace,
      role: agent.role || null,
      project_id: agent.project_id || null,
      closure_summary: closureSummary || null,
      recent_activity: autoSummary,
    };
    updateAgent(id, { status: "archived", metadata: JSON.stringify(metadata) });

    // Create terminate request for the launcher to kill the process
    if (pid) {
      createLaunchRequest("terminate", "", id, pid);
    }

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);

    res.json({ ok: true, terminated: !!pid, pid: pid || null });
  } catch (err) {
    logger.error({ err }, "Error closing agent");
    res.status(500).json({ error: "Failed to close agent" });
  }
});

// POST /:id/resume — resume an archived/suspended agent
router.post("/:id/resume", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (agent.status !== "archived" && agent.status !== "failed") {
      res.status(400).json({ error: `Agent is already ${agent.status}, not archived/failed` });
      return;
    }

    const folderPath = (agent.cwd as string) || "";

    // Create a resume launch request
    const launchResult = createLaunchRequest("resume", folderPath, id);

    // Extract context handoff from metadata before clearing it
    const metadata = JSON.parse((agent.metadata as string) || "{}");
    const contextHandoff = metadata.context_handoff || null;

    // Set agent status back to active (will be updated when it reconnects)
    updateAgent(id, { status: "active" });

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);

    res.json({
      ok: true,
      launch_request_id: (launchResult as Record<string, unknown>).id,
      context_handoff: contextHandoff,
    });
  } catch (err) {
    logger.error({ err }, "Error resuming agent");
    res.status(500).json({ error: "Failed to resume agent" });
  }
});

// DELETE /:id — delete agent
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    // Clean up files on disk
    const filePaths = deleteAgentFiles(id);
    for (const fp of filePaths) {
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
    // Remove agent files directory
    const filesDir = path.join(process.cwd(), "data", "files", id);
    try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch { /* ignore */ }

    deleteAgent(id);
    broadcast("agent-deleted", { id });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error deleting agent");
    res.status(500).json({ error: "Failed to delete agent" });
  }
});

// GET /:id/updates — get all updates for agent
router.get("/:id/updates", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const limit = parseIntQuery(req.query.limit, 100, 200);
    const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
    const result = getUpdates(id, limit, before);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error getting updates");
    res.status(500).json({ error: "Failed to get updates" });
  }
});

// POST /:id/messages — dashboard queues a message
router.post("/:id/messages", validate(messageSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { content, priority, source = "user", source_agent_id, source_peer_name } = req.body;

    addMessage(id, content, source, source_agent_id, priority || 0, source_peer_name);
    broadcast("message-queued", { agentId: id, content, priority: priority || 0, source, source_peer_name });

    // Publish to MQTT for instant delivery to agent sidecar
    publishAgentMessage(id, content, source);

    // Dispatch webhook for new message
    dispatchWebhook("message.received", {
      agent: agent as Record<string, unknown>,
      details: { content },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error queuing message");
    res.status(500).json({ error: "Failed to queue message" });
  }
});

// GET /:id/messages — get messages for agent
// ?status=pending — filter by status (useful for lightweight polling without POST)
// ?deliver=true  — mark pending messages as delivered in the same call
router.get("/:id/messages", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const statusFilter = req.query.status as string | undefined;
    const deliver = req.query.deliver === "true";

    if (statusFilter === "pending" && deliver) {
      // Heartbeat: update last_update_at so server knows agent is alive
      touchAgentHeartbeat(id);

      // Atomic: fetch pending + mark delivered in one transaction
      // Also re-surfaces any delivered-but-unacknowledged messages from previous poll cycles
      const rawMessages = getPendingMessages(id);

      // Append structured reminders to every message at delivery time.
      // Injected at delivery time only — DB record stays clean for the dashboard.
      // Three sections: ROLE (if set), PM RULES (if under a PM), SESSION MANAGER RULES (always).
      // All sections are MODEL-TIERED: opus gets full detail, sonnet medium, haiku minimal.
      const agentRole = agent.role as string | null;
      const agentProjectId = agent.project_id as string | null;
      const agentModel = agent.model as string | null;
      const tier = getModelTier(agentModel);

      const isPM = agentRole === "pm" || agentRole === "PM" ||
        (typeof agentRole === "string" && agentRole.trimStart().toLowerCase().startsWith("you are a project manager")) ||
        resolveRoleDefinition(agentRole)?.trimStart().toLowerCase().startsWith("you are a project manager");

      // Look up the project's PM agent ID (only for non-PM sub-agents with a project)
      let pmAgentId: string | null = null;
      if (agentProjectId && !isPM) {
        const proj = getProject(agentProjectId);
        pmAgentId = (proj?.pm_agent_id as string | null) ?? null;
      }

      // Section 1: ROLE (if role set)
      // Resolve role ID/displayName to full definition before injection.
      // PM role has its own dedicated injection. Other roles get the definition
      // wrapped with model-appropriate guidance.
      let ROLE_SECTION = "";
      if (agentRole) {
        const resolved = resolveRoleDefinition(agentRole);
        const roleDefinition = resolved ?? agentRole;
        const isPredefined = resolved !== null;
        if (isPM) {
          ROLE_SECTION = `
${getPmPreamble(tier)}
[ROLE — PROJECT MANAGER]
You run on ${tier === "opus" ? "Opus (heavyweight)" : tier === "sonnet" ? "Sonnet" : "Haiku"} as Project Manager. Plan, delegate, gate-review, E2E test. Never implement.

⛔ NEVER: write/edit files, run builds, git commit/push, use Agent/Task tools, use blocking terminal prompts.
⛔ NEVER: spawn fresh agents or kill/archive agents — you MAY resume dead pool agents (POST /api/agents/{id}/resume). Report to the user if a slot cannot be recovered.
✅ ONLY: plan tasks, assign to pool agents via relay, monitor progress, review PRs, E2E test via SIS, report to user.

PIPELINE — follow for every task:
1. PLAN: Break into phases. A phase = parallel sub-tasks that all must pass a gate review before the next phase.
2. DELEGATE: relay each sub-task to an idle agent with a feature branch name (feat/<slug>). Include full context + acceptance criteria. Never implement yourself.
3. MONITOR: poll via your bash monitoring loop (set up at startup). Nudge if silent >5min.
4. GATE REVIEW (when all PRs for a phase are open):
   a. Read each diff: git diff origin/dev...feat/<branch>
   b. Relay feedback if issues — wait for fixes + re-check
   c. Merge all approved PRs to dev
   d. E2E test via SIS: golden path + key edge cases, take screenshots as proof
   e. PASS → post timeline milestone → start next phase
   f. FAIL → assign bugfix tasks on new branches → re-test
5. REPORT: post a timeline milestone at each phase gate.
A phase is NOT complete until SIS tests pass. You are the quality gate.

POOL: GET /api/projects/{project_id}/agents to discover agents.
- Sonnet agents: complex tasks (multi-file, architectural, nuanced bugs). 2-5 files.
- Haiku agents: simple tasks (single-file, config, boilerplate, search-replace). Max 1-2 files.
- Uncertain? Use Sonnet. Haiku struggling? Reassign to Sonnet.

RELAY: curl -s -X POST "$AGENT_URL/api/agents/<id>/relay" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"content":"..."}'

ASSIGNMENT FORMAT — relay as plain text, NOT JSON (agents parse text, not JSON blobs):
  [TASK ASSIGNMENT]
  ROLE: <name>
  <full role definition>
  TASK:
  <full task spec, file locations, acceptance criteria>
  BRANCH: feat/<slug>
  WORKTREE: git worktree add ../<branch> -b <branch>
  Run /session-connect first, then begin immediately.

Also PATCH /api/agents/{id} {"role":"<fullDef>","task":"<summary>"} to update the dashboard.

SIS — E2E testing (MANDATORY — no other browser tool):
REST API at http://localhost:3002
- Screenshot: POST /screenshot {"scale":0.5,"format":"jpeg","quality":75}
- Click: POST /mouse {"action":"click","x":<x>,"y":<y>,"scale":0.5}
- Type: POST /keyboard {"action":"type","text":"..."}
- Key combo: POST /keyboard {"action":"key","keys":"ctrl+c"}
- Launch: POST /launch {"command":"firefox","args":["<url>"]}
- Health: GET /health
Coordinates use the scale you passed. Final verification must use SIS — take a screenshot as proof.
If SIS is down: bash /home/kuroneko2539/Research/ClaudeManager/screen-service/start.sh

BEFORE CONTEXT COMPACT: save project plan, phase status, agent assignments, pending reviews, blockers to claudeadmin/context-summary.md and post to dashboard. After compact: re-read context-summary, re-fetch project agents, then resume.`;
        } else {
          const wrappedRole = wrapRoleDefinition(tier, roleDefinition, isPredefined);
          ROLE_SECTION = `

[ROLE] ${wrappedRole}`;
        }
      }

      // Section 2: PM RULES (only if this agent is a sub-agent working under a PM)
      // Model-tiered: haiku gets minimal/concrete, sonnet medium, opus full detail
      const PM_RULES_SECTION = pmAgentId ? getPmSubRules(tier, pmAgentId) : "";

      // Section 3: SESSION MANAGER RULES (always appended)
      // Model-tiered: haiku gets 7 rules, sonnet 14, opus full 15
      const SESSION_RULES_SECTION = getSessionRules(tier);

      const messages = (rawMessages as Record<string, unknown>[]).map(m => ({
        ...m,
        content: typeof m.content === "string"
          ? m.content + ROLE_SECTION + PM_RULES_SECTION + SESSION_RULES_SECTION
          : m.content,
      }));

      // Include poll_delay_until so the agent knows to pause if set
      const agentData = getAgent(id);
      const pollDelayUntil = agentData?.poll_delay_until as string | null;
      if (pollDelayUntil) {
        res.json({ messages, poll_delay_until: pollDelayUntil });
      } else {
        res.json(messages);
      }
      return;
    } else if (statusFilter) {
      const messages = getMessagesByStatus(id, statusFilter);
      res.json(messages);
    } else {
      const limit = parseIntQuery(req.query.limit, 100, 200);
      const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
      const result = getMessages(id, limit, before);
      res.json(result);
    }
  } catch (err) {
    logger.error({ err }, "Error getting messages");
    res.status(500).json({ error: "Failed to get messages" });
  }
});

// POST /:id/messages/ack — agent explicitly acknowledges processed messages by ID
router.post("/:id/messages/ack", validate(ackMessageSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { ids, content } = req.body as { ids: number[]; content: string };
    if (!content || !content.trim()) {
      res.status(400).json({ error: "You must include content demonstrating you understood the message" });
      return;
    }
    const result = acknowledgeMessagesById(id, ids, content.trim());
    broadcast("agent-updated", getAgent(id));
    // Targeted event so the frontend can update specific message cards without a full refetch
    broadcast("messages-acknowledged", { agent_id: id, ids, ack_content: content.trim() });

    res.json({ ok: true, acknowledged: (result as { changes: number }).changes });
  } catch (err) {
    logger.error({ err }, "Error acknowledging messages");
    res.status(500).json({ error: "Failed to acknowledge messages" });
  }
});

// GET /:id/export/pdf — generate a PDF report via PrintingPress
router.get("/:id/export/pdf", async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const updatesResult = getUpdates(id, 10000);
    const msgsResult = getMessages(id, 10000);
    const filesResult = getFilesMeta(id, 1000);

    const payload = {
      agent,
      updates: updatesResult.data,
      messages: msgsResult.data,
      files: filesResult.data,
    };

    // Call the PDF generator service
    const pdfServiceUrl = process.env.PDF_SERVICE_URL || "http://pdf-generator:8090";
    const pdfRes = await fetch(`${pdfServiceUrl}/generate/agent-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!pdfRes.ok) {
      const errText = await pdfRes.text();
      logger.error({ errText }, "PDF generation failed");
      res.status(500).json({ error: "PDF generation failed", detail: errText });
      return;
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const agentTitle = (agent as Record<string, unknown>).title as string || "Agent";
    const filename = `${agentTitle.replace(/[^a-zA-Z0-9]/g, '_')}_Report.pdf`;

    // Auto-upload PDF as a session file
    try {
      const filePath = path.join(process.cwd(), "data", "files", id);
      fs.mkdirSync(filePath, { recursive: true });
      const pdfPath = path.join(filePath, `${Date.now().toString(36)}_${filename}`);
      fs.writeFileSync(pdfPath, pdfBuffer);
      addFile(id, filename, "application/pdf", pdfPath, pdfBuffer.length, "claude", "Auto-generated agent report");
      broadcast("agent-updated", getAgent(id));

      // Send push notification
      sendPushToAll(agentTitle, "PDF report ready for download", `/agent/${id}`).catch(() => {});
    } catch (uploadErr) {
      logger.error({ uploadErr }, "Failed to auto-upload PDF to session");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err }, "Error generating PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// POST /:id/files — upload a file attachment
router.post("/:id/files", upload.single("file"), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const source = (req.body?.source as string) || "user";
    const description = (req.body?.description as string) || "";
    const result = addFile(id, file.originalname, file.mimetype, file.path, file.size, source, description);
    res.json({
      ok: true,
      file: {
        id: result.lastInsertRowid,
        filename: file.originalname,
        source,
        description,
        mimetype: file.mimetype,
        size: file.size,
      },
    });
  } catch (err) {
    logger.error({ err }, "Error uploading file");
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// GET /:id/files — list file metadata for agent
router.get("/:id/files", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const limit = parseIntQuery(req.query.limit, 50, 100);
    const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
    const result = getFilesMeta(id, limit, before);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error listing files");
    res.status(500).json({ error: "Failed to list files" });
  }
});

// GET /:id/files/:fileId — download a file
router.get("/:id/files/:fileId", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const fileId = parseInt(param(req, "fileId"), 10);
    const file = getFile(id, fileId);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    if (file.file_path && fs.existsSync(file.file_path)) {
      res.setHeader("Content-Type", file.mimetype);
      res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
      res.sendFile(path.resolve(file.file_path));
    } else {
      res.status(404).json({ error: "File data not found on disk" });
    }
  } catch (err) {
    logger.error({ err }, "Error downloading file");
    res.status(500).json({ error: "Failed to download file" });
  }
});

// POST /:id/relay — agent-to-agent messaging
router.post("/:id/relay", validate(relaySchema), (req: Request, res: Response) => {
  try {
    const senderId = param(req, "id");
    const { target_agent_id, content } = req.body;

    // Validate sender exists
    const sender = getAgent(senderId);
    if (!sender) {
      res.status(404).json({ error: "Sender agent not found" });
      return;
    }

    // Validate target exists
    const target = getAgent(target_agent_id);
    if (!target) {
      res.status(404).json({ error: "Target agent not found" });
      return;
    }

    // Prevent agents from messaging themselves
    if (senderId === target_agent_id) {
      res.status(400).json({ error: "Agent cannot send a message to itself" });
      return;
    }

    // Deduplicate: skip if the same sender sent a very similar message to the
    // same target within the last 5 minutes.  Sub-agents often retry their
    // COMPLETED relay multiple times (especially when PM nudges trigger
    // re-relay via the ROLE_REMINDER), flooding the PM's inbox.
    const db = getDb();
    const recentDup = db.prepare(
      `SELECT id FROM messages
       WHERE agent_id = ? AND source_agent_id = ?
         AND created_at > datetime('now', '-300 seconds')
         AND substr(content, 1, 100) = substr(?, 1, 100)
       LIMIT 1`
    ).get(target_agent_id, senderId, content) as Record<string, unknown> | undefined;
    if (recentDup) {
      logger.info({ senderId, targetId: target_agent_id }, "Duplicate relay suppressed (same content within 60s)");
      res.json({ ok: true, deduplicated: true });
      return;
    }

    // Create message on target agent with source info
    addMessage(target_agent_id, content, "agent", senderId);
    broadcast("message-queued", { agentId: target_agent_id, content, source: "agent", sourceAgentId: senderId });

    // Record relay in both timelines so it's visible in the dashboard
    const senderTitle = (sender.title as string) || senderId;
    const targetTitle = (target.title as string) || target_agent_id;
    const preview = content.length > 120 ? content.substring(0, 120) + "…" : content;
    addUpdate(senderId, "relay", JSON.stringify({ direction: "sent", to_id: target_agent_id, to_title: targetTitle, message: content }), `→ ${targetTitle}: ${preview}`);
    addUpdate(target_agent_id, "relay", JSON.stringify({ direction: "received", from_id: senderId, from_title: senderTitle, message: content }), `← ${senderTitle}: ${preview}`);

    // Publish to MQTT for instant delivery to agent sidecar
    publishAgentMessage(target_agent_id, content, "agent", senderId);

    // Dispatch webhook for message received on target
    dispatchWebhook("message.received", {
      agent: target as Record<string, unknown>,
      details: { content, source: "agent", sourceAgentId: senderId },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error relaying message");
    res.status(500).json({ error: "Failed to relay message" });
  }
});

// POST /:id/signal — send a signal (ctrl-c, enter) to the agent's terminal
router.post("/:id/signal", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { signal } = req.body as { signal?: string };
    if (!signal || !["ctrl-c", "enter"].includes(signal)) {
      res.status(400).json({ error: "Invalid signal. Use 'ctrl-c' or 'enter'" });
      return;
    }

    const pid = (agent as Record<string, unknown>).pid as number | null;
    if (!pid) {
      res.status(400).json({ error: "Agent has no PID — cannot send signal" });
      return;
    }

    // Create a signal launch request for the launcher to process
    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO launch_requests (type, folder_path, resume_agent_id, target_pid, status) VALUES (?, ?, ?, ?, 'pending')"
    );
    stmt.run("signal", signal, id, pid);

    broadcast("launch-request-created", { type: "signal", signal, agentId: id, pid });

    res.json({ ok: true, signal, pid });
  } catch (err) {
    logger.error({ err }, "Error sending signal");
    res.status(500).json({ error: "Failed to send signal" });
  }
});

// POST /:id/input — type text into the agent's terminal
router.post("/:id/input", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { text } = req.body as { text?: string };
    if (!text) {
      res.status(400).json({ error: "Provide 'text' to type into the terminal" });
      return;
    }

    const pid = (agent as Record<string, unknown>).pid as number | null;
    if (!pid) {
      res.status(400).json({ error: "Agent has no PID — cannot send input" });
      return;
    }

    // Create an input launch request for the launcher to process
    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO launch_requests (type, folder_path, resume_agent_id, target_pid, status) VALUES (?, ?, ?, ?, 'pending')"
    );
    stmt.run("input", text, id, pid);

    broadcast("launch-request-created", { type: "input", text, agentId: id, pid });

    res.json({ ok: true, text, pid });
  } catch (err) {
    logger.error({ err }, "Error sending input");
    res.status(500).json({ error: "Failed to send input" });
  }
});

// POST /:id/share-file — share a file from this agent to another agent
router.post("/:id/share-file", (req: Request, res: Response) => {
  try {
    const sourceId = param(req, "id");
    const { file_id, target_agent_id } = req.body as { file_id?: number; target_agent_id?: string };

    if (!file_id || !target_agent_id) {
      res.status(400).json({ error: "Provide 'file_id' and 'target_agent_id'" });
      return;
    }

    const source = getAgent(sourceId);
    if (!source) {
      res.status(404).json({ error: "Source agent not found" });
      return;
    }

    const target = getAgent(target_agent_id);
    if (!target) {
      res.status(404).json({ error: "Target agent not found" });
      return;
    }

    // Get the source file
    const sourceFile = getFile(sourceId, file_id);
    if (!sourceFile) {
      res.status(404).json({ error: "File not found or does not belong to source agent" });
      return;
    }

    const sf = sourceFile as Record<string, unknown>;

    // Copy the physical file to the target agent's directory
    const sourceFilePath = sf.file_path as string;
    if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
      res.status(404).json({ error: "Source file not found on disk" });
      return;
    }

    const targetDir = path.join(process.cwd(), "data", "files", target_agent_id);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFileName = `${Date.now().toString(36)}_${sf.filename as string}`;
    const targetFilePath = path.join(targetDir, targetFileName);
    fs.copyFileSync(sourceFilePath, targetFilePath);

    // Create file record for the target agent
    // addFile(agentId, filename, mimetype, filePath, size, source, description)
    addFile(
      target_agent_id,
      sf.filename as string,
      sf.mimetype as string,
      targetFilePath,
      sf.size as number,
      `shared from ${sourceId}`,
      "",
    );

    broadcast("file-shared", {
      sourceAgentId: sourceId,
      targetAgentId: target_agent_id,
      filename: sf.filename,
    });

    res.json({ ok: true, filename: sf.filename });
  } catch (err) {
    logger.error({ err }, "Error sharing file");
    res.status(500).json({ error: "Failed to share file" });
  }
});

// POST /:id/terminal — broadcast terminal output via SSE (ephemeral, not stored)
router.post("/:id/terminal", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { output, stream } = req.body as { output?: string; stream?: string };
    const text = output || stream || "";
    if (!text) {
      res.status(400).json({ error: "Provide 'output' or 'stream' field" });
      return;
    }

    // Broadcast to SSE clients without persisting to DB
    broadcast("terminal-output", {
      agentId: id,
      output: text,
      timestamp: new Date().toISOString(),
    });

    // Also publish to MQTT for real-time delivery
    publishAgentUpdate(id, { type: "terminal", output: text });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error broadcasting terminal output");
    res.status(500).json({ error: "Failed to broadcast terminal output" });
  }
});

// POST /:id/cost — report token/cost usage for an agent session
router.post("/:id/cost", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { input_tokens, output_tokens, cost_usd, label } = req.body as {
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      label?: string;
    };

    if (input_tokens === undefined && output_tokens === undefined && cost_usd === undefined) {
      res.status(400).json({ error: "Provide at least one of: input_tokens, output_tokens, cost_usd" });
      return;
    }

    // Validate: no negative values
    if ((input_tokens !== undefined && input_tokens < 0) ||
        (output_tokens !== undefined && output_tokens < 0) ||
        (cost_usd !== undefined && cost_usd < 0)) {
      res.status(400).json({ error: "Cost values must not be negative" });
      return;
    }

    // Log cost event with label for breakdown tracking
    addCostEvent(
      id,
      label || "unlabeled",
      input_tokens || 0,
      output_tokens || 0,
      cost_usd || 0,
    );

    // Accumulate costs in agent metadata
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse((agent.metadata as string) || "{}"); } catch { /* ignore */ }

    const costs = (meta.costs as Record<string, number>) || { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    if (input_tokens !== undefined) costs.input_tokens = (costs.input_tokens || 0) + input_tokens;
    if (output_tokens !== undefined) costs.output_tokens = (costs.output_tokens || 0) + output_tokens;
    if (cost_usd !== undefined) costs.cost_usd = Math.round(((costs.cost_usd || 0) + cost_usd) * 1e6) / 1e6;
    meta.costs = costs;

    updateAgent(id, { metadata: JSON.stringify(meta) });

    res.json({ ok: true, costs });
  } catch (err) {
    logger.error({ err }, "Error reporting cost");
    res.status(500).json({ error: "Failed to report cost" });
  }
});

// GET /:id/costs — per-agent cost breakdown by task label
router.get("/:id/costs", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const detail = req.query.detail === "true";
    const summary = getCostEventsSummary(id);

    // Calculate total
    let totalInput = 0, totalOutput = 0, totalCost = 0;
    for (const row of summary) {
      totalInput += (row.input_tokens as number) || 0;
      totalOutput += (row.output_tokens as number) || 0;
      totalCost += (row.cost_usd as number) || 0;
    }

    const result: Record<string, unknown> = {
      total: { input_tokens: totalInput, output_tokens: totalOutput, cost_usd: Math.round(totalCost * 1e6) / 1e6 },
      breakdown: summary,
    };

    // Optionally include raw events
    if (detail) {
      result.events = getCostEvents(id);
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error fetching agent costs");
    res.status(500).json({ error: "Failed to fetch agent costs" });
  }
});

// GET /analytics/costs — aggregate cost data across all agents
router.get("/analytics/costs", (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = db.prepare("SELECT id, title, metadata, project_id FROM agents").all() as {
      id: string; title: string; metadata: string | null; project_id: string | null;
    }[];

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    const agentCosts: { id: string; title: string; project_id: string | null; costs: Record<string, number> }[] = [];

    for (const agent of agents) {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(agent.metadata || "{}"); } catch { continue; }
      const costs = meta.costs as Record<string, number> | undefined;
      if (costs && (costs.input_tokens || costs.output_tokens || costs.cost_usd)) {
        totalInput += costs.input_tokens || 0;
        totalOutput += costs.output_tokens || 0;
        totalCost += costs.cost_usd || 0;
        agentCosts.push({ id: agent.id, title: agent.title, project_id: agent.project_id, costs });
      }
    }

    res.json({
      total: { input_tokens: totalInput, output_tokens: totalOutput, cost_usd: Math.round(totalCost * 1e6) / 1e6 },
      agents: agentCosts,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching cost analytics");
    res.status(500).json({ error: "Failed to fetch cost analytics" });
  }
});

export default router;
