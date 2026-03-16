import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  getAllAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getUpdates,
  addUpdate,
  getPendingMessages,
  addMessage,
  getMessages,
  getMessagesByStatus,
  addFile,
  getFile,
  getFilesMeta,
} from "../db.js";
import { broadcast } from "../sse.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

/** Extract a route param as a string (Express 5 types return string | string[]) */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

// GET / — list all agents
router.get("/", (_req: Request, res: Response) => {
  try {
    const agents = getAllAgents();
    res.json(agents);
  } catch (err) {
    console.error("Error listing agents:", err);
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// GET /bootstrap — full setup instructions for a fresh Claude session (must be before /:id)
router.get("/bootstrap", (req: Request, res: Response) => {
  try {
    const serverUrl = `${req.protocol}://${req.get("host")}`;
    const U = serverUrl; // shorthand

    res.json({
      name: "Agent Manager Bootstrap",
      version: "1.1",
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

      claude_md_protocol: `# ⚠️ MANDATORY SESSION PROTOCOL — READ AND ACT ON THIS FIRST

These actions are NON-NEGOTIABLE. Execute them at the specified trigger points. Do not skip, defer, or "get to them later."

## On FIRST user message → \`/session-init\`
Before responding to the user, invoke the /session-init skill. It handles:
- Agent Manager: connect, health check, register
- Memory: read recent logs, load global memories, create today's log file

## On EVERY user message → \`/agent-checkin\`
After /session-init (or on its own for subsequent messages), invoke /agent-checkin to:
- POST an update to Agent Manager with what you're about to do
- Check for pending messages from the dashboard

## After EVERY atomic unit of work → update
Every time you complete a discrete piece of work (bug fix, feature, config change, test):
1. **Memory log**: append to \`.claude/memories/<yyyy-mm-dd>.md\` with UTC timestamp
2. **Agent Manager**: POST a granular update via /agent-checkin
3. **Project/Todo files**: update status in \`.claude/projects/\` or \`.claude/todos/\` if applicable

## When IDLE → start polling
After finishing a response with no further work: \`/loop 1m\` to poll Agent Manager for pending messages.

## Polling behaviour
- **Empty response** (\`[]\`): silent no-op. Do not output anything or interrupt work.
- **Message present**: treat it exactly like a user message — act on it at the next natural pause point. Do not interrupt mid-task.

## Communication frequency
Communicate **frequently** via the Agent Manager — especially when:
- You need user approval or input (post the question as an update so it's visible on the dashboard)
- You're blocked on a decision
- You've completed a significant piece of work
- You encounter an error or unexpected behaviour

Do not wait for the user to check in. Post updates proactively so the dashboard always reflects current state.

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
ls -t ~/.claude/projects/<project-path>/*.jsonl | head -1
# Extract the UUID filename (without path or extension)
\`\`\`
The \`<project-path>\` is the Claude project key — the current working directory with path separators replaced by \`--\` and prefixed with drive letter, e.g. \`c--Users-kuron-Research-MyProject\`.

**CRITICAL**: Resolve this to a fixed string immediately. Store it mentally and use this exact string for ALL subsequent /agent-checkin calls and the /loop polling command. Never re-evaluate — if the ID contains \`$(...)\` in a cron prompt, it will expand differently each time and break polling.

Register with the session UUID:
\`\`\`bash
curl -s -X POST "$AGENT_URL/api/agents/$SESSION_UUID/updates" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"status","title":"<brief task from user message>","summary":"Session started","content":"Session initialized"}'
\`\`\`
Check \`pendingMessages\` in response. Act on any found.

### 2. Memory — load context
1. Read the 2-3 most recent \`.claude/memories/*.md\` files to understand where things left off.
2. Read \`~/.claude/memory/MEMORY.md\` and any relevant referenced memory files.
3. If today's log (\`.claude/memories/<yyyy-mm-dd>.md\`) doesn't exist, create it with header \`# Session Log — <yyyy-mm-dd>\`

### 3. Check poll delay
Read \`~/.claude/poll-delays.json\`. If the current agent ID has a \`delay_until\` timestamp in the future, do NOT start polling. Inform the user and offer to resume early (requires local confirmation).

### 4. Idle polling — start
\`\`\`
/loop 1m curl -s "$AGENT_URL/api/agents/<SESSION_UUID>/messages?status=pending&deliver=true"
\`\`\`
This must use the literal UUID string, not a shell expression.

**On each poll response**: If the response is a JSON object with a \`poll_delay_until\` field, save the delay to \`~/.claude/poll-delays.json\`, cancel the polling cron, and schedule a one-shot cron at the delay time to auto-restart polling.

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
    "content": "<detail if needed>"
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
Read all \`.claude/projects/*.md\` and \`.claude/todos/*.md\` files to build the arrays. **Every todo MUST include a \`"project"\` field**. Use \`"Unattached"\` if not part of a project. If no active projects/todos, send empty arrays.

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
      },

      api_reference: {
        health: { method: "GET", path: "/api/health", description: "Returns {status:'ok'}" },
        list_agents: { method: "GET", path: "/api/agents", description: "List all agents with pending message counts" },
        bootstrap: { method: "GET", path: "/api/agents/bootstrap", description: "This endpoint — setup instructions for fresh Claude" },
        get_agent: { method: "GET", path: "/api/agents/:id", description: "Get single agent with computed fields" },
        patch_agent: { method: "PATCH", path: "/api/agents/:id", body: "{title?, status?, metadata?, poll_delay_until?}", description: "Update agent fields" },
        delete_agent: { method: "DELETE", path: "/api/agents/:id", description: "Delete agent and all associated data" },
        post_update: { method: "POST", path: "/api/agents/:id/updates", body: "{type, content, summary?, title?, progress?, projects?, todos?}", description: "Post an update (auto-creates agent if new). Returns {ok, pendingMessages}" },
        get_updates: { method: "GET", path: "/api/agents/:id/updates", description: "Get all updates for an agent" },
        post_message: { method: "POST", path: "/api/agents/:id/messages", body: "{content}", description: "Queue a message for the agent" },
        get_messages: { method: "GET", path: "/api/agents/:id/messages", query: "?status=pending&deliver=true", description: "Get messages. With deliver=true, atomically marks pending as delivered" },
        upload_file: { method: "POST", path: "/api/agents/:id/files", body: "multipart: file (required), source ('user'|'claude'), description (text)", description: "Upload a file attachment or artefact" },
        list_files: { method: "GET", path: "/api/agents/:id/files", description: "List file metadata (without binary data)" },
        get_file: { method: "GET", path: "/api/agents/:id/files/:fileId", description: "Download a file with correct content-type" },
        export_pdf: { method: "GET", path: "/api/agents/:id/export/pdf", description: "Generate and download a branded PDF report of agent activity" },
        events_sse: { method: "GET", path: "/api/events", description: "SSE stream: agent-updated, agent-deleted, message-queued events" },
      },
    });
  } catch (err) {
    console.error("Error generating bootstrap:", err);
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
    console.error("Error getting agent:", err);
    res.status(500).json({ error: "Failed to get agent" });
  }
});

// POST /:id/updates — agent posts an update
router.post("/:id/updates", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { type = "text", content, summary, title, progress, projects, todos } = req.body;

    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    // Create agent if it doesn't exist
    const existing = getAgent(id);
    if (!existing) {
      createAgent(id, title || "Untitled Agent");
    }

    // Update title if provided (on existing agent)
    if (title && existing) {
      updateAgent(id, { title });
    }

    // Auto-unarchive if agent receives an update while archived
    if (existing && (existing as Record<string, unknown>).status === "archived") {
      updateAgent(id, { status: "active" });
    }

    // Normalize content to always be a JSON string
    let contentStr: string;
    if (typeof content === "object") {
      contentStr = JSON.stringify(content);
    } else {
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
    addUpdate(id, type, contentStr, summary);

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

    const pendingMessages = getPendingMessages(id);
    res.json({ ok: true, pendingMessages });
  } catch (err) {
    console.error("Error posting update:", err);
    res.status(500).json({ error: "Failed to post update" });
  }
});

// PATCH /:id — update agent metadata
router.patch("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { title, status, metadata, poll_delay_until } = req.body;
    const fields: { title?: string; status?: string; metadata?: string; poll_delay_until?: string | null } = {};

    if (title !== undefined) fields.title = title;
    if (status !== undefined) fields.status = status;
    if (metadata !== undefined) {
      fields.metadata = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    }
    if (poll_delay_until !== undefined) fields.poll_delay_until = poll_delay_until;

    updateAgent(id, fields);

    const updatedAgent = getAgent(id);
    broadcast("agent-updated", updatedAgent);

    res.json(updatedAgent);
  } catch (err) {
    console.error("Error updating agent:", err);
    res.status(500).json({ error: "Failed to update agent" });
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

    deleteAgent(id);
    broadcast("agent-deleted", { id });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting agent:", err);
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

    const updates = getUpdates(id);
    res.json(updates);
  } catch (err) {
    console.error("Error getting updates:", err);
    res.status(500).json({ error: "Failed to get updates" });
  }
});

// POST /:id/messages — dashboard queues a message
router.post("/:id/messages", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const agent = getAgent(id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    addMessage(id, content);
    broadcast("message-queued", { agentId: id, content });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error queuing message:", err);
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
      const messages = getMessages(id);
      res.json(messages);
    }
  } catch (err) {
    console.error("Error getting messages:", err);
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

    const updates = getUpdates(id);
    const msgs = getMessages(id);

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
      updates,
      messages: msgs,
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
      console.error("PDF generation failed:", errText);
      res.status(500).json({ error: "PDF generation failed", detail: errText });
      return;
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Agent_Report_${id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generating PDF:", err);
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
    const result = addFile(id, file.originalname, file.mimetype, file.buffer, file.size, source, description);
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
    console.error("Error uploading file:", err);
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

    const files = getFilesMeta(id);
    res.json(files);
  } catch (err) {
    console.error("Error listing files:", err);
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

    res.setHeader("Content-Type", file.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.setHeader("Content-Length", file.size);
    res.send(file.data);
  } catch (err) {
    console.error("Error downloading file:", err);
    res.status(500).json({ error: "Failed to download file" });
  }
});

export default router;
