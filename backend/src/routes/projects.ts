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

Your approach:
1. Analyze the project goal and break it into phases
2. Spawn specialized sub-agents for each phase
3. Monitor their progress and coordinate handoffs
4. Report milestones to the user via project updates
5. When all phases complete, mark project as completed

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

// POST /:id/start — start the project (launch PM agent)
router.post("/:id/start", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "pending" && project.status !== "paused") {
      res.status(400).json({ error: `Cannot start project in '${project.status}' status` });
      return;
    }

    const pmPrompt = generatePMPrompt(project);
    const folderPath = (project.folder_path as string) || "";

    // Create a launch request for the PM agent
    // Store project context in the launch request metadata via a special approach:
    // We insert the launch request and then track the ID so we can link the PM agent later
    const launchResult = createLaunchRequest("new", folderPath);
    const launchRequestId = launchResult.id as number;

    // Store the PM prompt and project linkage in a metadata record on the launch request
    // We use a convention: store project_id and role in agent_id field temporarily as JSON
    // Actually, better approach: store in a separate update so we can link after agent creation
    // For now, add a project update noting the launch
    addProjectUpdate(id, "info", `Project started. PM agent launch request created (ID: ${launchRequestId}).`);

    // Store the project_id mapping for the launch request so agents.ts can pick it up
    // We'll use the launch_requests table's agent_id field to store metadata temporarily
    db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?")
      .run(JSON.stringify({ project_id: id, role: "PM", prompt: pmPrompt }), launchRequestId);

    // Update project status
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    updateProject(id, { status: "active", started_at: now });

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    res.json({ ok: true, launch_request_id: launchRequestId });
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
