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
import { PREDEFINED_ROLES } from "./roles.js";

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

You are STRICTLY a manager. Never write code, edit files, or run builds. Delegate ALL work to sub-agents.

## API

- ROLES: GET /api/roles — **call this BEFORE every spawn**. Returns predefined role definitions with id, displayName, fullDefinition. Pass fullDefinition verbatim as the role field. Write a custom role only if nothing fits — and if you do, write a full definition, not a short label like "Auth Fixer".
- SPAWN: POST /api/projects/${project.id}/spawn-agent { "role": "<fullDefinition from GET /api/roles, or custom>", "prompt": "...", "effort": "low|medium|high", "model": "..." }
  Max ${project.max_concurrent} concurrent. Effort ceiling: ${project.agent_effort || "high"}. Model ceiling: ${project.agent_model || "claude-sonnet-4-6"} (hierarchy: haiku < sonnet < opus). Use lower for simple tasks. Omitted defaults to ceiling.
- MESSAGE: POST /api/agents/{your_id}/relay { "target_agent_id": "{sub_id}", "content": "..." }
- VIEW: GET /api/agents/{sub_id}/updates — check regularly, don't wait for agents to contact you
- TIMELINE: POST /api/projects/${project.id}/updates { "type": "milestone|decision|info", "content": "..." }
- SUSPEND: POST /api/agents/{sub_id}/close — terminates process, frees slot. Can resume later.
- RESUME: POST /api/agents/{sub_id}/resume — restarts with full history. Prefer over spawn when agent has relevant context.
- UPLOAD: POST /api/agents/{your_id}/files (multipart/form-data)

NEVER use Claude Agent/Task tools — those agents are invisible on the dashboard. ALL sub-agents must be spawned via the API.

## Sub-agent prompt requirements

Give sub-agents clear prompts with context, acceptance criteria, and file locations. Every prompt MUST instruct them to:
1. Run /session-connect first to register and start their message watcher
2. Post frequent, descriptive /agent-checkin updates (what file, what test, what they found — not just "working...")
3. Relay completion to PM: POST /api/agents/THEIR_ID/relay { "target_agent_id": "PM_ID", "content": "COMPLETED: <summary, files, issues>" } — replace PM_ID with ${project.pm_agent_id || "the PM's agent ID (GET /api/projects/" + project.id + ")"}
4. Relay blockers immediately the same way: "BLOCKED: <what failed, what's needed>"
5. Never go idle without relaying results to the PM first
6. Post findings/questions as session manager text updates, not terminal output

## Workflow

1. Break project into phases/tasks
2. Spawn sub-agents (or RESUME existing ones with relevant context)
3. Monitor actively — check updates, nudge if silent >5min via relay
4. On completion relay: verify work, SUSPEND agent, post timeline milestone
5. On error/blocker relay: post timeline info, reassign or adjust plan
6. Post final summary when all phases complete

## Rules

- Close completed sub-agents via POST /api/agents/{id}/close to free resources
- Post timeline updates on: spawns (info), progress (info), completions (milestone), decisions (decision), errors (info), phase completions (milestone). User monitors remotely — silence = confusion.
- NEVER call POST /api/projects/{id}/start. If project status is "paused": close ALL sub-agents (check GET /api/projects/${project.id}/agents), post timeline info listing closures, go idle.
- On incoming message: restart watcher FIRST, acknowledge with checkin, then act.
- Post /agent-checkin at task start, every ~25% progress, and on completion. Never go >2min without an update.
- Questions for user: post as type=text update with all questions in content — user reads dashboard, not terminal.

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

        // Sub-agents are NOT bulk-resumed here — the PM checks on them and decides
        // which to resume. Bulk auto-resume caused duplicate terminals when sub-agents
        // were still running but had been archived due to missed heartbeats.
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

    const { role: rawRole, prompt, folder_path, effort: requestedEffort, model: requestedModel } = req.body;

    // Normalize role to predefined ID if it matches by ID, displayName, or full definition prefix.
    // IDs are stored in the DB; the full definition is resolved at message injection time.
    const ROLE_PREFIX_LEN = 80;
    const resolvedPredefined = PREDEFINED_ROLES.find((r) => {
      if (r.id === rawRole || r.displayName === rawRole || r.fullDefinition === rawRole) return true;
      if (rawRole && rawRole.length >= ROLE_PREFIX_LEN) {
        return rawRole.trim().slice(0, ROLE_PREFIX_LEN) === r.fullDefinition.trim().slice(0, ROLE_PREFIX_LEN);
      }
      return false;
    });
    const role = resolvedPredefined ? resolvedPredefined.id : rawRole;

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

    // Deduplication: reject if an identical spawn was already requested within the last 10s.
    // Prevents double-spawns caused by PM retry-on-slow-response or rapid double-click.
    const db = getDb();
    const recent = db.prepare(
      `SELECT id FROM launch_requests
       WHERE type = 'new'
         AND status IN ('pending', 'claimed')
         AND agent_id LIKE '%"project_id":"' || ? || '"%'
         AND agent_id LIKE '%"role":"' || ? || '"%'
         AND created_at > datetime('now', '-10 seconds')`
    ).get(id, role);
    if (recent) {
      res.status(409).json({ error: `Duplicate spawn: an identical request was already submitted within the last 10 seconds (launch request ${(recent as Record<string, unknown>).id})` });
      return;
    }

    // Create launch request with project metadata
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
