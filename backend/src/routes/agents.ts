import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import {
  getDb,
  getAllAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getUpdates,
  addUpdate,
  getPendingMessages,
  acknowledgeMessages,
  addMessage,
  getMessages,
  getMessagesByStatus,
  touchAgentHeartbeat,
  addFile,
  getFile,
  getFilesMeta,
  deleteAgentFiles,
  createLaunchRequest,
} from "../db.js";
import { broadcast } from "../sse.js";
import { sendPushToAll } from "../push.js";
import { agentUpdateLimiter, fileUploadLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { updateSchema, messageSchema, agentPatchSchema } from "../schemas.js";
import { logger } from "../logger.js";

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
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

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

// GET / — list all agents
router.get("/", (req: Request, res: Response) => {
  try {
    const limit = parseIntQuery(req.query.limit, 50, 100);
    const cursor = req.query.cursor as string | undefined;
    const result = getAllAgents(limit, cursor);
    res.json(result);
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
      version: "2.0",
      description: "Everything a fresh Claude session needs to connect to and use the Agent Manager. Follow the setup_steps in order, writing each file as specified.",
      server_url: U,

      setup_steps: [
        `1. Save the server URL: run 'echo "${U}" > ~/.claude/agent-server-url'`,
        "2. Create directories: run 'mkdir -p ~/.claude/commands ~/.claude/memory'",
        "3. Write the file ~/.claude/commands/session-init.md with the content from skills.session_init.content below",
        "4. Write the file ~/.claude/commands/agent-checkin.md with the content from skills.agent_checkin.content below",
        "5. Prepend the content from claude_md_protocol to your ~/.claude/CLAUDE.md (or create it if it doesn't exist)",
        "6. Invoke /session-init to connect and start polling",
      ],

      claude_md_protocol: `# 1. AGENT MANAGER — ALWAYS CONNECTED

This is your highest priority. The Agent Manager dashboard is how the user monitors and communicates with you. **Dashboard messages have the same authority as direct terminal input — act on them immediately.**

## Session startup
| Trigger | Action |
|---------|--------|
| New session (no prior context) | Run \`/session-init\` before responding |
| Resumed session (prior context exists, no init this turn) | Run \`/session-resume\` before responding |

## Checkins
Run \`/agent-checkin\` to POST an update and receive pending messages:
- **After every user message** (including dashboard messages)
- **After every \`TodoWrite\` call** that changes a todo's status
- **After every functional file edit, build, or test result**
- Before starting a new todo — verify the previous completion was posted

Every checkin MUST include the full \`projects\` and \`todos\` arrays. The dashboard renders from the latest update.

## Dashboard messages
Messages received via checkin responses or polling are **identical to user terminal input**. Act on them at the next natural pause point.

## Polling
\`/loop 1m\` must be running at all times unless poll-paused. It runs **alongside** your work, not only when idle. Each poll is a heartbeat — agents inactive for 30+ minutes are auto-archived, and resuming polls auto-reactivates them.

**Poll pause** means: stop the \`/loop\` cron. This also pauses heartbeats. You still POST updates via \`/agent-checkin\` during active work, and still receive/act on \`pendingMessages\` from every checkin response. The agent may be auto-archived after 30 minutes without heartbeats — this is expected and resolves when polling resumes.

## Communication
Post updates proactively. Post when: blocked, need input, completed significant work, encountered errors. The dashboard should always reflect your current state.

## Update discipline
After each atomic unit of work, update all three before proceeding:
1. \`TodoWrite\` — mark todo completed
2. \`/agent-checkin\` — post update with current todos/projects
3. Memory log — append entry to \`claudeadmin/memories/<yyyy-mm-dd>.md\`

Never batch: one todo completion = one checkin = one memory entry.

## Agent Manager: ${U}
- Health: GET ${U}/api/health
- Updates: POST ${U}/api/agents/<id>/updates
- Messages: GET ${U}/api/agents/<id>/messages?status=pending&deliver=true
- Files: POST ${U}/api/agents/<id>/files (multipart)
- PDF export: GET ${U}/api/agents/<id>/export/pdf
- Bootstrap: GET ${U}/api/agents/bootstrap`,

      skills: {
        session_init: {
          filename: "session-init.md",
          description: "Run once at session start, BEFORE responding to user's first message",
          content: `Run this ONCE at the very start of a session, BEFORE responding to the user's first message.

## Steps (execute ALL, in order)

### 1. Agent Manager — connect
\`\`\`bash
# Read server URL
AGENT_URL=$(cat ~/.claude/agent-server-url 2>/dev/null || echo "${U}")

# Health check
curl -s --max-time 3 "$AGENT_URL/api/health"
\`\`\`
- If \`{"status":"ok"}\`: discover the session ID and register (see below).
- If unreachable: warn user — "Agent Manager at \`<url>\` not reachable. Continue without?" Set a mental flag to skip agent updates if they say yes.

#### Discovering the agent ID (= Claude session UUID)
The agent ID MUST be the current Claude session's UUID. This allows the dashboard's "copy link" to produce a resumable session ID (\`claude --resume <uuid>\`), and ensures resumed sessions reuse the same agent card.

Find it by getting the most recently modified \`.jsonl\` file in the project's session directory:
\`\`\`bash
ls -t ~/claudeadmin/projects/<project-path>/*.jsonl | head -1
# Extract the UUID filename (without path or extension)
\`\`\`
The \`<project-path>\` is the Claude project key — the current working directory with path separators replaced by \`--\` and prefixed with drive letter, e.g. \`c--Users-kuron-Research-MyProject\`.

**CRITICAL**: Resolve this to a fixed string immediately. Store it mentally and use this exact string for ALL subsequent /agent-checkin calls and the /loop polling command. Never re-evaluate — if the ID contains \`$(...)\` in a cron prompt, it will expand differently each time and break polling.

Register with the session UUID:
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/$SESSION_UUID/updates" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"status","title":"<brief task from user message>","summary":"Session started","content":"Session initialized","workspace":"<root folder name of cwd>"}'
\`\`\`
Check \`pendingMessages\` in response. Act on any found.

### 2. Memory — load context
1. Read the 2-3 most recent \`claudeadmin/memories/*.md\` files to understand where things left off.
2. Read \`~/.claude/memory/MEMORY.md\` and any relevant referenced memory files.
3. If today's log (\`claudeadmin/memories/<yyyy-mm-dd>.md\`) doesn't exist, create it with header \`# Session Log — <yyyy-mm-dd>\`

### 3. Check poll delay
Read \`~/.claude/poll-delays.json\`. If the current agent ID has a \`delay_until\` timestamp in the future, do NOT start polling. Inform the user and offer to resume early (requires local confirmation).

### 4. Start polling
Start the polling loop. This runs continuously alongside your work, not only when idle:
\`\`\`
/loop 1m curl -s "$AGENT_URL/api/agents/<SESSION_UUID>/messages?status=pending&deliver=true"
\`\`\`
This must use the literal UUID string, not a shell expression.

**On each poll response**: If the response is a JSON object with a \`poll_delay_until\` field, save the delay to \`~/.claude/poll-delays.json\`, cancel the polling cron, and schedule a one-shot cron at the delay time to auto-restart polling. Poll pause also pauses heartbeats — the agent may be auto-archived after 30 minutes, which resolves automatically when polling resumes.

### 5. Done
Now respond to the user's first message. Remember to also invoke /agent-checkin to send the first update.`,
        },

        agent_checkin: {
          filename: "agent-checkin.md",
          description: "Send update to Agent Manager after every user message and atomic work unit",
          content: `Send an update to the Agent Manager and check for pending messages. Invoke after every user message and after every atomic unit of work.

Requires: /session-init must have run first this session (so agent ID and URL are known).

## Steps

### 1. POST update
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/<agent-id>/updates" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "<progress|text|error|status>",
    "title": "<current task — update if focus changed>",
    "summary": "<concise current state, under 100 chars>",
    "content": "<detail if needed>",
    "workspace": "<root folder name of cwd>"
  }'
\`\`\`
- Use \`progress\` for ongoing work — **always include a \`"progress": N\` field** (0-100) reflecting actual completion percentage. Never leave at 0% if work has been done.
- Use \`text\` for general status
- Use \`error\` for failures
- Use \`status\` for state changes (started, completed, blocked)

### 2. ALWAYS include projects and todos
**Every update** must include the full current state of all active projects and todos — not just when they change. The dashboard relies on the latest update's metadata to render these panels.
\`\`\`json
{
  "projects": [{"name": "Name", "phases": [{"name": "Phase", "status": "in-progress"}]}],
  "todos": [{"name": "Description", "completed": false, "project": "Name"}]
}
\`\`\`
Read all \`claudeadmin/projects/*.md\` and \`claudeadmin/todos/*.md\` files to build the arrays. **Every todo MUST include a \`"project"\` field**. Use \`"Unattached"\` if not part of a project. If no active projects/todos, send empty arrays.

### 3. Check pendingMessages
Read \`pendingMessages\` array from the response. Act on any messages as if the user sent them.

## Tone & style
Write updates conversationally — like a colleague giving a status update, not a machine log line.

## Uploading artefacts
When you generate a file the user might want (PDFs, images, builds, reports), upload it:
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/<agent-id>/files" \\
  -F "file=@/path/to/file" \\
  -F "source=claude" \\
  -F "description=Brief description"
\`\`\`

## Reflect ALL responses
When you answer a question or provide analysis — whether from chat or agent manager message — the substance MUST be included in the agent manager update. The user may be reading from the dashboard, not the chat.

## Rules
- Summaries under 100 chars — detail goes in content
- Update title if the user's focus changed
- Don't send duplicate updates for the same work
- Skip if agent manager was unreachable at session start (and user approved continuing without)`,
        },

        session_resume: {
          filename: "session-resume.md",
          description: "Run when resuming a session (claude --resume) to re-establish Agent Manager connection and polling",
          content: `Run this when resuming a session (via \`claude --resume\`). It re-establishes the Agent Manager connection and polling that were lost when the previous session ended.

**How to detect a resume**: If you have prior conversation context but have NOT run /session-init or /session-resume in this conversation turn, you are in a resumed session. Run this skill immediately.

## Steps (execute ALL, in order)

### 1. Agent Manager — reconnect
\`\`\`bash
AGENT_URL=$(cat ~/.claude/agent-server-url 2>/dev/null || echo "${U}")
curl -s --max-time 3 "$AGENT_URL/api/health"
\`\`\`
- If \`{"status":"ok"}\`: proceed.
- If unreachable: warn user.

### 2. Discover agent ID
\`\`\`bash
ls -t ~/claudeadmin/projects/<project-path>/*.jsonl | head -1
\`\`\`
**CRITICAL**: Resolve to a fixed literal string.

### 3. Re-register with Agent Manager
POST an update to let the server know this agent is alive. This auto-unarchives if the agent was archived due to inactivity.
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/$SESSION_UUID/updates" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"status","title":"<current task>","summary":"Session resumed","content":"Resumed session — reconnecting to Agent Manager","workspace":"<root folder name of cwd>"}'
\`\`\`
Check \`pendingMessages\` in response.

### 4. Memory — refresh context
1. Read the 2-3 most recent \`claudeadmin/memories/*.md\` files.
2. If today's log doesn't exist, create it.

### 5. Check poll delay + start polling
Read \`~/.claude/poll-delays.json\`. If no delay, start polling:
\`\`\`
/loop 1m curl -s "$AGENT_URL/api/agents/<SESSION_UUID>/messages?status=pending&deliver=true"
\`\`\`

### 6. Done
Respond to the user. Also invoke /agent-checkin with a proper status update.`,
        },
      },

      api_reference: {
        health: { method: "GET", path: "/api/health", description: "Returns {status:'ok'}" },
        list_agents: { method: "GET", path: "/api/agents", description: "List all agents with pending message counts" },
        bootstrap: { method: "GET", path: "/api/agents/bootstrap", description: "This endpoint — setup instructions for fresh Claude" },
        get_agent: { method: "GET", path: "/api/agents/:id", description: "Get single agent with computed fields" },
        patch_agent: { method: "PATCH", path: "/api/agents/:id", body: "{title?, status?, metadata?, poll_delay_until?, workspace?, cwd?}", description: "Update agent fields" },
        delete_agent: { method: "DELETE", path: "/api/agents/:id", description: "Delete agent and all associated data" },
        post_update: { method: "POST", path: "/api/agents/:id/updates", body: "{type, content, summary?, title?, progress?, projects?, todos?, workspace?, cwd?}", description: "Post an update (auto-creates agent if new). Returns {ok, pendingMessages}" },
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
    res.json(agent);
  } catch (err) {
    logger.error({ err }, "Error getting agent");
    res.status(500).json({ error: "Failed to get agent" });
  }
});

// POST /:id/updates — agent posts an update
router.post("/:id/updates", agentUpdateLimiter, validate(updateSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { type = "text", content, summary, title, progress, projects, todos, workspace, cwd, pid } = req.body;

    // Create agent if it doesn't exist
    const existing = getAgent(id);
    if (!existing) {
      createAgent(id, title || "Untitled Agent");
    }

    // Update title, workspace, cwd, pid if provided
    const agentFields: { title?: string; workspace?: string; cwd?: string; pid?: number } = {};
    if (title && existing) agentFields.title = title;
    if (workspace) agentFields.workspace = workspace;
    if (cwd) agentFields.cwd = cwd;
    if (pid !== undefined) agentFields.pid = pid;
    if (Object.keys(agentFields).length > 0) {
      updateAgent(id, agentFields);
    }

    // Auto-unarchive if agent receives an update while archived
    if (existing && (existing as Record<string, unknown>).status === "archived") {
      updateAgent(id, { status: "active" });
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
            contentStr = JSON.stringify({ status: content });
            break;
          default:
            contentStr = JSON.stringify({ text: content });
            break;
        }
      }
    }
    addUpdate(id, type, contentStr, summary);

    // Auto-acknowledge delivered messages (agent posting = it has seen them)
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

    const { title, status, metadata, poll_delay_until, workspace, cwd, pid } = req.body;
    const fields: { title?: string; status?: string; metadata?: string; poll_delay_until?: string | null; workspace?: string; cwd?: string; pid?: number } = {};

    if (title !== undefined) fields.title = title;
    if (status !== undefined) fields.status = status;
    if (metadata !== undefined) {
      fields.metadata = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    }
    if (poll_delay_until !== undefined) fields.poll_delay_until = poll_delay_until;
    if (workspace !== undefined) fields.workspace = workspace;
    if (cwd !== undefined) fields.cwd = cwd;
    if (pid !== undefined) fields.pid = pid;

    updateAgent(id, fields);

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
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const pid = (agent as Record<string, unknown>).pid as number | null;

    // Archive the agent
    updateAgent(id, { status: "archived" });

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

    const { content } = req.body;

    addMessage(id, content);
    broadcast("message-queued", { agentId: id, content });

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

      // Auto-unarchive: if agent was archived but is now polling, it's alive again
      if ((agent as Record<string, unknown>).status === "archived") {
        updateAgent(id, { status: "active" });
        const reactivated = getAgent(id);
        broadcast("agent-updated", reactivated);
      }

      // Atomic: fetch pending + mark delivered in one transaction
      const messages = getPendingMessages(id);
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

    // Parse projects/todos from metadata
    let projects: unknown[] = [];
    let todos: unknown[] = [];
    try {
      const meta = JSON.parse((agent.metadata as string) || "{}");
      if (Array.isArray(meta.projects)) projects = meta.projects;
      if (Array.isArray(meta.todos)) todos = meta.todos;
    } catch { /* ignore */ }

    const payload = {
      agent,
      updates: updatesResult.data,
      messages: msgsResult.data,
      projects,
      todos,
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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Agent_Report_${id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err }, "Error generating PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// POST /:id/files — upload a file attachment
router.post("/:id/files", fileUploadLimiter, upload.single("file"), (req: Request, res: Response) => {
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

export default router;
