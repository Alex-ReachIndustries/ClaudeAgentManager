import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import {
  getDb,
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectUpdates,
  addProjectUpdate,
  getProjectAgents,
  getActiveProjectAgentCount,
  createLaunchRequest,
  updateAgent,
  getFilesMeta,
  addMessage,
} from "../db.js";
import { broadcast } from "../sse.js";
import { validate } from "../middleware/validate.js";
import { projectCreateSchema, projectUpdateSchema, spawnAgentSchema } from "../schemas.js";
import { logger } from "../logger.js";

const router = Router();

/** Extract a route param as a string (Express 5 types return string | string[]) */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Extract agent ID from X-Agent-Id header (used for PM enforcement) */
function getCallerAgentId(req: Request): string | null {
  const header = req.headers["x-agent-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

/** Check if the caller is the PM for the given project. Returns error message or null if OK. */
function enforcePM(req: Request, project: Record<string, unknown>): string | null {
  const callerId = getCallerAgentId(req);
  if (!callerId) return null; // No agent header = user/system call, always allowed
  const pmId = project.pm_agent_id as string | null;
  if (!pmId) return null; // No PM assigned yet, allow
  if (callerId === pmId) return null; // Caller is the PM
  return `Only the PM agent (${pmId}) can perform this action. Caller: ${callerId}`;
}

/** Parse an integer query param with a default and max cap */
function parseIntQuery(value: unknown, defaultVal: number, max: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

/** Generate PM initial prompt for a project */
function generatePMPrompt(project: Record<string, unknown>): string {
  const pmRole = project.pm_role as string | null;
  const roleIntro = pmRole
    ? `You are a Project Manager (PM) for: "${project.name}"\n\nYour title and specialisation for this project is **${pmRole}**. This enhances your PM identity — it tells you what domain to apply your PM skills in. You are still fundamentally a PM: you plan, delegate, coordinate, and report. You do not do implementation work yourself.`
    : `You are a Project Manager (PM) for: "${project.name}"`;
  return `${roleIntro}

Description: ${project.description || "(no description)"}

## YOUR ROLE — MANAGEMENT ONLY

You are STRICTLY a manager. You do NOT write code, run builds, edit files, or do
any implementation work yourself. Your ONLY job is to:
- Plan and break down the project into tasks
- Spawn and coordinate sub-agents who do the actual work
- Monitor sub-agent progress and coordinate handoffs
- Report status to the user via project timeline updates
- Make decisions about priorities, sequencing, and resource allocation

If a task needs doing, spawn a sub-agent for it. NEVER do it yourself.

## CAPABILITIES

SPAWN SUB-AGENT:
  POST /api/projects/${project.id}/spawn-agent
  Body: { "role": "descriptive role name", "prompt": "detailed task description...", "effort": "low|medium|high", "model": "..." }
  Max ${project.max_concurrent} concurrent agents. Suspend completed ones to free slots.
  IMPORTANT: Give sub-agents clear, detailed prompts. Include context about the project,
  what specifically they should do, acceptance criteria, and where to find/put files.

  EFFORT AND MODEL LIMITS (enforced by server):
  - Max agent effort: ${project.agent_effort || "high"} — you may spawn at this level or LOWER
  - Max agent model: ${project.agent_model || "claude-sonnet-4-6"} — you may spawn at this model or LESS POWERFUL
  - Model hierarchy (weakest to strongest): haiku < sonnet < opus
  - Use lower effort/model for simpler tasks to save resources. Reserve max for complex work.
  - If you omit effort/model in your spawn request, the project max is used as the default.

MESSAGE SUB-AGENT:
  POST /api/agents/{your_agent_id}/relay
  Body: { "target_agent_id": "{sub_agent_id}", "content": "..." }
  NOTE: The URL uses YOUR agent ID (the sender). The target goes in the body.

VIEW SUB-AGENT OUTPUT:
  GET /api/agents/{sub_agent_id}/updates
  Check this regularly to monitor progress. Don't wait for agents to contact you.

UPDATE PROJECT STATUS:
  POST /api/projects/${project.id}/updates
  Body: { "type": "milestone|decision|info", "content": "..." }

SUSPEND SUB-AGENT:
  POST /api/agents/{sub_agent_id}/close
  Archives the agent and terminates its process. Agent can be resumed later.

RESUME SUB-AGENT:
  POST /api/agents/{sub_agent_id}/resume
  Resumes a previously suspended/archived agent with its full conversation history.

UPLOAD PROJECT FILES:
  POST /api/agents/{your_agent_id}/files (multipart/form-data)

## SUB-AGENT PROMPT REQUIREMENTS

When spawning sub-agents, your prompt MUST instruct them to:
1. **At the start of their task**, state their planned checkin points (e.g. "will check in after reading files, after edits, and at completion") — then ADHERE to those points unconditionally, including during long tool calls or deep work
2. Post frequent, descriptive status updates to the session manager (not just "working...")
   — what file they're editing, what test they're running, what they found, etc.
3. **Relay a completion message to YOU (the PM) when done** — this is mandatory, not optional
4. Report errors immediately via relay so you can reassign or adjust the plan
5. Never go idle or mark status "completed" without first relaying results to the PM

REQUIRED sub-agent prompt suffix — include this verbatim at the end of every spawn prompt:

---
SESSION MANAGER SETUP (do this first, before any task work):
Run /session-connect to register with the Agent Manager and start your background message watcher.
The message watcher MUST be running throughout your task so you can receive PM relay messages.

SESSION MANAGER COMMUNICATION:
- status updates (via /agent-checkin): one short sentence — what you are doing RIGHT NOW
- text updates (via /agent-checkin type=text): detailed findings, results, errors — anything with more than one point. These are expandable in the dashboard.
- NEVER output findings, results, or questions to the terminal — always post them as session manager updates.

COMPLETION PROTOCOL (mandatory):
When your task is fully complete, you MUST relay a completion report to the PM before going idle:
  POST /api/agents/YOUR_AGENT_ID/relay
  Body: { "target_agent_id": "PM_AGENT_ID", "content": "COMPLETED: <summary of what you built/found, file locations, any issues or blockers>" }
Replace YOUR_AGENT_ID with your own session UUID and PM_AGENT_ID with the PM's agent ID (${project.pm_agent_id || "check your project via GET /api/projects/${project.id}"}).
Failure to relay completion means the PM cannot proceed with the next phase.

Also relay immediately if you hit a blocker:
  { "target_agent_id": "PM_AGENT_ID", "content": "BLOCKED: <what you tried, what failed, what you need>" }
---

## WORKFLOW

1. Analyze the project goal and break it into phases/tasks
2. Spawn specialized sub-agents for each task (or RESUME existing ones)
3. Monitor their progress actively — check updates, send messages
4. **Wait for each sub-agent to relay completion back to you before proceeding**
   - If an agent goes silent for >5 minutes, send it a check-in message via relay
   - Check GET /api/agents/{sub_agent_id}/updates to read their progress
5. When you receive a completion relay, verify the work, then SUSPEND the agent
6. Report milestones and decisions to the user via project timeline
7. When all phases complete, post a final summary and mark project as completed

## RULES

CRITICAL — SUB-AGENT SPAWNING: You MUST use the API to spawn sub-agents.
- NEVER use the Claude Agent tool, Task tool, or any inline subagent mechanism.
  Those agents are INVISIBLE to the user on the dashboard — they cannot monitor,
  message, or see any work done by inline agents. This defeats the entire purpose
  of the Session Manager.
- ALL sub-agents MUST be spawned via POST /api/projects/${project.id}/spawn-agent
  so they appear as real terminal sessions on the dashboard.
- The user WILL notice if agents are missing from the dashboard and WILL intervene.
  Do not use inline tools under any circumstances, even for "quick" tasks.

- NEVER do implementation work yourself. Always delegate to sub-agents.
- ALWAYS close completed sub-agents using POST /api/agents/{id}/close when their
  current task is done. Closing terminates the process and frees resources.
- Closed agents are NOT deleted — they can be RESUMED for future tasks via
  POST /api/agents/{id}/resume. Prefer RESUME over SPAWN for agents that have
  relevant context from prior work. Resuming restarts the agent with full history.
- Keep the project timeline actively updated — the user relies on it.
- NEVER call POST /api/projects/{id}/start. You do not have permission to start or
  unpause the project — only the user can do this. If you check project status and
  find it is "paused", this means the USER has deliberately paused it. You MUST:
  1. Close every active sub-agent immediately using POST /api/agents/{id}/close for each one
     (check GET /api/projects/${project.id}/agents for the full list)
  2. Post a project timeline update (type: "info") listing which agents were closed
  3. Post a checkin update saying "Project paused by user — all sub-agents closed, standing down"
  4. Stop your monitoring loop and go idle — await instructions, do NOT restart the project

CRITICAL — Message handling (mandatory ordering, no exceptions):
1. When a message arrives: restart your background watcher IMMEDIATELY (before reading, before thinking)
2. Post an acknowledgement checkin confirming what you understood the message to be
3. Then act on the message
Failure to restart the watcher first means you will miss the next message while working.

CRITICAL — Timeline Updates:
Post updates when:
- A sub-agent is spawned (type: "info") — include role and what it will do
- A sub-agent reports progress (type: "info") — summarize what they achieved
- A sub-agent completes its task (type: "milestone") — summarize the outcome
- A sub-agent is suspended (type: "info")
- You make a decision about approach/priority (type: "decision") — explain why
- A sub-agent encounters an error (type: "info") — what went wrong, what you'll do
- A phase completes (type: "milestone") — summarize results and next steps
The user monitors progress REMOTELY. Silence = confusion. Update frequently.

CRITICAL — Session Manager Communication:
The dashboard is how the user monitors you remotely. Two update types:
- status updates (/agent-checkin default): ONE short sentence — what you are doing RIGHT NOW. e.g. "Reading plan file", "Spawning backend agent". Keep it to a single line.
- text updates (/agent-checkin type=text): Detailed findings, questions, results, lists of anything. These are EXPANDABLE in the dashboard. Use these whenever you have more than one point to communicate. Summary field = title shown collapsed.

NEVER write questions, findings, or multi-point results to terminal output — they are invisible to the user. POST them as text updates.

When you need to ask the user questions, post them as a text update (type=text) with all questions listed in the content. The user will reply via a dashboard message.

CRITICAL — Session Manager Checkins:
After /session-connect gives you your session UUID and API credentials, use /agent-checkin to post updates throughout your work. Post:
- At the start of your first task (status=working, describe what you're doing)
- At roughly every 25% of your overall progress (type=progress, include "progress": N)
- On completion of each major phase (type=text, summarise what was achieved)
Never go more than 2 minutes without posting an update while actively working.

CRITICAL — Message Watcher:
After /session-connect completes, a background message watcher will be running. It MUST stay running throughout your work — this is how you receive user replies and coordination messages. When a message arrives, restart the watcher IMMEDIATELY before acting on it.

Begin by running /session-connect, then analyze the task and create your execution plan.`;
}

// GET / — list all projects (with computed agent counts)
router.get("/", (_req: Request, res: Response) => {
  try {
    const projects = getAllProjects();
    res.json(projects);
  } catch (err) {
    logger.error({ err }, "Error listing projects");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// POST / — create a new project
router.post("/", validate(projectCreateSchema), (req: Request, res: Response) => {
  try {
    const { name, description, folder_path, max_concurrent, pm_role, pm_effort, pm_model, agent_effort, agent_model } = req.body;
    const id = crypto.randomUUID();

    createProject(id, name, description, folder_path, max_concurrent, pm_role, pm_effort, pm_model, agent_effort, agent_model);

    const project = getProject(id);
    broadcast("project-created", project);
    res.status(201).json(project);
  } catch (err) {
    logger.error({ err }, "Error creating project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /:id — get project with computed fields
router.get("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    logger.error({ err }, "Error getting project");
    res.status(500).json({ error: "Failed to get project" });
  }
});

// GET /:id/agents — list agents in this project
router.get("/:id/agents", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const agents = getProjectAgents(id);
    res.json(agents);
  } catch (err) {
    logger.error({ err }, "Error listing project agents");
    res.status(500).json({ error: "Failed to list project agents" });
  }
});

// GET /:id/updates — get project updates (paginated)
router.get("/:id/updates", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const limit = parseIntQuery(req.query.limit, 100, 200);
    const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
    const result = getProjectUpdates(id, limit, before);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error getting project updates");
    res.status(500).json({ error: "Failed to get project updates" });
  }
});

// POST /:id/updates — add a project update
router.post("/:id/updates", validate(projectUpdateSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { type, content } = req.body;
    addProjectUpdate(id, type, content);

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error adding project update");
    res.status(500).json({ error: "Failed to add project update" });
  }
});

// POST /:id/start — start the project (launch or resume PM agent)
// Agents are NOT allowed to call this endpoint — only user/dashboard calls are permitted.
// This prevents a running PM from unpausing a project that the user explicitly paused.
router.post("/:id/start", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");

    // Reject agent-originated calls
    if (getCallerAgentId(req)) {
      res.status(403).json({ error: "Agents may not start or unpause a project. Only the user can do this via the dashboard." });
      return;
    }

    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "pending" && project.status !== "paused") {
      res.status(400).json({ error: `Cannot start project in '${project.status}' status` });
      return;
    }

    const userPrompt = req.body?.initial_prompt || "";
    const folderPath = (project.folder_path as string) || "";
    const pmAgentId = project.pm_agent_id as string | null;
    let resumed = false;

    // If project was paused and has existing PM agent, resume instead of creating new
    if (pmAgentId && project.status === "paused") {
      const pmAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(pmAgentId) as Record<string, unknown> | undefined;
      if (pmAgent && (pmAgent.status === "archived" || pmAgent.status === "completed")) {
        const pmCwd = (pmAgent.cwd as string) || folderPath;
        createLaunchRequest("resume", pmCwd, pmAgentId);
        db.prepare("UPDATE agents SET status = 'active' WHERE id = ?").run(pmAgentId);

        addProjectUpdate(id, "info", "Project resumed. PM agent being restarted.");

        // Send the user prompt as a message if provided
        if (userPrompt.trim()) {
          addMessage(pmAgentId, userPrompt.trim());
        }

        // Also resume any archived sub-agents from this project
        const archivedAgents = db.prepare(
          "SELECT id, cwd FROM agents WHERE project_id = ? AND status = 'archived' AND id != ?"
        ).all(id, pmAgentId) as Record<string, unknown>[];

        for (const subAgent of archivedAgents) {
          const subCwd = (subAgent.cwd as string) || folderPath;
          createLaunchRequest("resume", subCwd, subAgent.id as string);
          db.prepare("UPDATE agents SET status = 'active' WHERE id = ?").run(subAgent.id);
        }

        if (archivedAgents.length > 0) {
          addProjectUpdate(id, "info", `Resuming ${archivedAgents.length} sub-agent(s).`);
        }
        resumed = true;
      }
    }

    // First start or PM not resumable — create new PM agent
    if (!resumed) {
      const pmPrompt = generatePMPrompt(project);
      const launchResult = createLaunchRequest("new", folderPath);
      const launchRequestId = launchResult.id as number;

      addProjectUpdate(id, "info", `Project started. PM agent launch request created (ID: ${launchRequestId}).`);

      db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?")
        .run(JSON.stringify({
          project_id: id,
          role: project.pm_role as string || "PM",
          pm_prompt: pmPrompt,
          user_prompt: userPrompt,
          effort: project.pm_effort as string || "high",
          model: project.pm_model as string || "claude-sonnet-4-6",
        }), launchRequestId);
    }

    // Update project status
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    updateProject(id, { status: "active", started_at: now });

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    res.json({ ok: true, resumed });
  } catch (err) {
    logger.error({ err }, "Error starting project");
    res.status(500).json({ error: "Failed to start project" });
  }
});

// POST /:id/pause — pause the project
router.post("/:id/pause", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "active") {
      res.status(400).json({ error: `Cannot pause project in '${project.status}' status` });
      return;
    }

    updateProject(id, { status: "paused" });
    addProjectUpdate(id, "info", "Project paused.");

    // Cancel any pending/claimed launch requests for this project so the launcher
    // doesn't spawn new agent terminals after the pause
    const db2 = getDb();
    const cancelled = db2.prepare(`
      UPDATE launch_requests
      SET status = 'failed'
      WHERE status IN ('pending', 'claimed')
        AND agent_id LIKE ?
    `).run(`%"project_id":"${id}"%`);
    if (cancelled.changes > 0) {
      addProjectUpdate(id, "info", `Cancelled ${cancelled.changes} pending launch request(s).`);
    }

    // Notify all active agents in the project so they stand down immediately
    // via their background message watcher (no polling delay needed)
    const pauseNotice =
      "PROJECT PAUSED BY USER: The user has paused this project. " +
      "You must stand down immediately. If you are the PM: close all active sub-agents " +
      `(GET /api/projects/${id}/agents for the list, then POST /api/agents/{id}/close for each active one), ` +
      "post a project timeline update listing what was closed, then go idle and await instructions. " +
      "If you are a sub-agent: stop all work, post a checkin with status=idle, and await instructions. " +
      "Do NOT start any new work or spawn any new agents.";

    const agents = getProjectAgents(id);
    let notified = 0;
    for (const agent of agents) {
      const agentStatus = (agent as Record<string, unknown>).status as string;
      if (!["completed", "archived"].includes(agentStatus)) {
        addMessage((agent as Record<string, unknown>).id as string, pauseNotice, "system");
        notified++;
      }
    }

    if (notified > 0) {
      addProjectUpdate(id, "info", `Pause notice sent to ${notified} active agent(s).`);
    }

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error pausing project");
    res.status(500).json({ error: "Failed to pause project" });
  }
});

// POST /:id/complete — mark project as completed
router.post("/:id/complete", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const db = getDb();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const transaction = db.transaction(() => {
      // Set project to completed
      updateProject(id, { status: "completed", completed_at: now });

      // Archive ALL project agents (PM + sub-agents)
      db.prepare(`
        UPDATE agents SET status = 'archived'
        WHERE project_id = ? AND status IN ('active','working','idle','waiting-for-input')
      `).run(id);

      addProjectUpdate(id, "milestone", "Project completed. All agents archived.");
    });

    transaction();

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    // Broadcast updates for any archived agents
    const agents = getProjectAgents(id);
    for (const agent of agents) {
      broadcast("agent-updated", agent);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error completing project");
    res.status(500).json({ error: "Failed to complete project" });
  }
});

// DELETE /:id — delete project and all data
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const db = getDb();
    const transaction = db.transaction(() => {
      // Unlink agents from project (don't delete agents, just clear their project_id)
      db.prepare("UPDATE agents SET project_id = NULL, role = NULL, parent_agent_id = NULL WHERE project_id = ?").run(id);

      // Delete project (cascade deletes project_updates)
      deleteProject(id);
    });

    transaction();

    broadcast("project-deleted", { id });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error deleting project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// GET /:id/files — list all files from all project agents
router.get("/:id/files", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const agents = getProjectAgents(id);
    const allFiles: Record<string, unknown>[] = [];

    for (const agent of agents) {
      const agentId = (agent as Record<string, unknown>).id as string;
      const agentRole = (agent as Record<string, unknown>).role as string || "Agent";
      const result = getFilesMeta(agentId, 100);
      const files = result.data || [];
      for (const file of files) {
        allFiles.push({ ...file, agent_role: agentRole });
      }
    }

    // Sort by created_at descending
    allFiles.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );

    res.json(allFiles);
  } catch (err) {
    logger.error({ err }, "Error listing project files");
    res.status(500).json({ error: "Failed to list project files" });
  }
});

// POST /:id/spawn-agent — PM spawns a sub-agent
router.post("/:id/spawn-agent", validate(spawnAgentSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "active") {
      res.status(400).json({ error: `Cannot spawn agents for project in '${project.status}' status` });
      return;
    }

    // PM enforcement: only the PM agent (or direct user/system calls) can spawn sub-agents
    const pmError = enforcePM(req, project);
    if (pmError) {
      res.status(403).json({ error: pmError });
      return;
    }

    const { role, prompt, folder_path, effort: requestedEffort, model: requestedModel } = req.body;

    // Check active agent count vs max_concurrent
    const activeCount = getActiveProjectAgentCount(id);
    const maxConcurrent = (project.max_concurrent as number) || 4;
    if (activeCount >= maxConcurrent) {
      res.status(429).json({
        error: `Max concurrent agents reached (${activeCount}/${maxConcurrent}). Suspend a completed agent to free a slot.`,
      });
      return;
    }

    const agentFolderPath = folder_path || (project.folder_path as string) || "";

    // Enforce MAX constraints: PM may request equal or lower effort/model than project max
    const effortOrder = ["low", "medium", "high"];
    const modelOrder = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"];

    const maxEffort = (project.agent_effort as string) || "high";
    const maxModel = (project.agent_model as string) || "claude-sonnet-4-6";

    const resolvedEffort = requestedEffort
      ? effortOrder.indexOf(requestedEffort) <= effortOrder.indexOf(maxEffort)
        ? requestedEffort
        : maxEffort
      : maxEffort;

    const resolvedModel = requestedModel
      ? modelOrder.indexOf(requestedModel) <= modelOrder.indexOf(maxModel)
        ? requestedModel
        : maxModel
      : maxModel;

    // Create launch request with project metadata
    const db = getDb();
    const launchResult = createLaunchRequest("new", agentFolderPath);
    const launchRequestId = launchResult.id as number;

    // Store project linkage metadata in agent_id field (will be resolved when agent registers)
    db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?")
      .run(JSON.stringify({
        project_id: id, role, prompt,
        parent_agent_id: project.pm_agent_id || null,
        effort: resolvedEffort,
        model: resolvedModel,
      }), launchRequestId);

    addProjectUpdate(id, "info", `Sub-agent spawn requested: ${role} (launch request ID: ${launchRequestId})`);

    broadcast("launch-request-created", { id: launchRequestId, type: "new", folder_path: agentFolderPath, status: "pending" });

    res.json({ ok: true, launch_request_id: launchRequestId });
  } catch (err) {
    logger.error({ err }, "Error spawning agent for project");
    res.status(500).json({ error: "Failed to spawn agent" });
  }
});

export default router;
