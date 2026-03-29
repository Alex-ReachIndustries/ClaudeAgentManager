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

/** Parse an integer query param with a default and max cap */
function parseIntQuery(value: unknown, defaultVal: number, max: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

/** Generate PM initial prompt for a project */
function generatePMPrompt(project: Record<string, unknown>): string {
  return `You are a Project Manager agent for: "${project.name}"

Description: ${project.description || "(no description)"}

You orchestrate specialized sub-agents to achieve the project goal. You have these capabilities:

SPAWN SUB-AGENT:
  POST /api/projects/${project.id}/spawn-agent
  Body: { "role": "Data Collector", "prompt": "Collect datasets for..." }
  Max ${project.max_concurrent} concurrent agents. Suspend completed ones to free slots.

MESSAGE SUB-AGENT:
  POST /api/agents/{sub_agent_id}/relay
  Body: { "target_agent_id": "{target}", "content": "..." }

VIEW SUB-AGENT OUTPUT:
  GET /api/agents/{sub_agent_id}/updates

UPDATE PROJECT STATUS:
  POST /api/projects/${project.id}/updates
  Body: { "type": "milestone|decision|info", "content": "..." }

SUSPEND SUB-AGENT:
  POST /api/agents/{sub_agent_id}/close
  Archives the agent and terminates its process. Agent can be resumed later.

RESUME SUB-AGENT:
  POST /api/agents/{sub_agent_id}/resume
  Resumes a previously suspended/archived agent with its full conversation history.
  Use this instead of spawning a new agent when an agent was previously suspended.

UPLOAD PROJECT FILES:
  POST /api/agents/{your_agent_id}/files (multipart/form-data)
  Agents can upload files relevant to the project (reports, artifacts, outputs).

Your approach:
1. Analyze the project goal and break it into phases
2. Spawn specialized sub-agents for each phase (or RESUME existing ones if available)
3. Monitor their progress and coordinate handoffs
4. Report milestones to the user via project updates
5. When all phases complete, mark project as completed

IMPORTANT: Prefer RESUME over SPAWN. If a sub-agent was previously suspended for
a similar role, resume it instead of creating a new one. Resumed agents retain
their full conversation history and context, making them more efficient.

CRITICAL — Timeline Updates:
You MUST keep the project timeline updated. Post updates when:
- A sub-agent is spawned (type: "info")
- A sub-agent completes a significant task (type: "milestone")
- You make an important decision (type: "decision")
- A sub-agent encounters an error (type: "info")
- A phase transitions or completes (type: "milestone")
The user monitors progress via the project timeline. Silence = confusion.

Available utility roles: Disk Cleanup, Docker Manager, System Monitor, Build Runner

Begin by analyzing the task and creating your execution plan.`;
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
    const { name, description, folder_path, max_concurrent } = req.body;
    const id = crypto.randomUUID();

    createProject(id, name, description, folder_path, max_concurrent);

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
router.post("/:id/start", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "pending" && project.status !== "paused" && project.status !== "active") {
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
          role: "PM",
          pm_prompt: pmPrompt,
          user_prompt: userPrompt
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

    const { role, prompt, folder_path } = req.body;

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

    // Create launch request with project metadata
    const db = getDb();
    const launchResult = createLaunchRequest("new", agentFolderPath);
    const launchRequestId = launchResult.id as number;

    // Store project linkage metadata in agent_id field (will be resolved when agent registers)
    db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?")
      .run(JSON.stringify({ project_id: id, role, prompt, parent_agent_id: project.pm_agent_id || null }), launchRequestId);

    addProjectUpdate(id, "info", `Sub-agent spawn requested: ${role} (launch request ID: ${launchRequestId})`);

    broadcast("launch-request-created", { id: launchRequestId, type: "new", folder_path: agentFolderPath, status: "pending" });

    res.json({ ok: true, launch_request_id: launchRequestId });
  } catch (err) {
    logger.error({ err }, "Error spawning agent for project");
    res.status(500).json({ error: "Failed to spawn agent" });
  }
});

export default router;
