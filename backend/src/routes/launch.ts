import { Router, type Request, type Response } from "express";
import {
  getDb,
  createLaunchRequest,
  getLaunchRequestsByStatus,
  updateLaunchRequest,
  getLaunchRequest,
  getAgent,
  updateAgent,
  updateProject,
  addMessage,
} from "../db.js";
import { broadcast } from "../sse.js";
import { launchLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { launchRequestSchema } from "../schemas.js";
import { logger } from "../logger.js";

const router = Router();

// POST / — create a new launch request
router.post("/", launchLimiter, validate(launchRequestSchema), (req: Request, res: Response) => {
  try {
    const { type = "new", folder_path, resume_agent_id } = req.body;

    if (!folder_path && type === "new") {
      res.status(400).json({ error: "folder_path is required for new agent launches" });
      return;
    }

    if (type === "resume" && !resume_agent_id) {
      res.status(400).json({ error: "resume_agent_id is required for resume launches" });
      return;
    }

    if (type === "terminate" && !resume_agent_id) {
      res.status(400).json({ error: "resume_agent_id (target agent) is required for terminate requests" });
      return;
    }

    if (type === "terminate-resume" && !resume_agent_id) {
      res.status(400).json({ error: "resume_agent_id is required for terminate-resume requests" });
      return;
    }

    const { target_pid, role, task, effort, model, wt_window } = req.body;
    const request = createLaunchRequest(type, folder_path || "", resume_agent_id, target_pid, wt_window);

    // If role/task/effort/model provided (from Android new-agent UI), store as metadata for the launcher
    if ((role || task || effort || model) && request.id) {
      const db = getDb();
      const meta = JSON.stringify({ role: role || null, prompt: task || null, effort: effort || null, model: model || null });
      db.prepare("UPDATE launch_requests SET agent_id = ? WHERE id = ?").run(meta, request.id);
    }

    broadcast("launch-request-created", request);
    res.status(201).json({ ok: true, request });
  } catch (err) {
    logger.error({ err }, "Error creating launch request");
    res.status(500).json({ error: "Failed to create launch request" });
  }
});

// GET / — list launch requests, optionally filtered by status
router.get("/", (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    if (status) {
      const requests = getLaunchRequestsByStatus(status);
      res.json(requests);
    } else {
      // Return all recent (last 100)
      const pending = getLaunchRequestsByStatus("pending");
      const claimed = getLaunchRequestsByStatus("claimed");
      res.json([...pending, ...claimed]);
    }
  } catch (err) {
    logger.error({ err }, "Error listing launch requests");
    res.status(500).json({ error: "Failed to list launch requests" });
  }
});

// PATCH /:id — update a launch request (claim, complete, fail)
router.patch("/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
    const { status, agent_id } = req.body;

    const existing = getLaunchRequest(id);
    if (!existing) {
      res.status(404).json({ error: "Launch request not found" });
      return;
    }

    // Atomic claim guard: reject if already claimed/completed to prevent double-spawn
    // when two concurrent launcher invocations race to claim the same request.
    if (status === "claimed" && (existing as Record<string, unknown>).status !== "pending") {
      res.status(409).json({ error: `Cannot claim request with status '${(existing as Record<string, unknown>).status}'` });
      return;
    }

    // Check if the existing agent_id contains project metadata (JSON from project start/spawn)
    const existingRecord = existing as Record<string, unknown>;
    let projectMeta: { project_id?: string; role?: string; prompt?: string; parent_agent_id?: string } | null = null;
    if (existingRecord.agent_id && typeof existingRecord.agent_id === "string") {
      try {
        const parsed = JSON.parse(existingRecord.agent_id as string);
        if (parsed && parsed.project_id) {
          projectMeta = parsed;
        }
      } catch {
        // Not JSON — it's a regular agent_id, ignore
      }
    }

    const fields: Record<string, string> = {};
    if (status) fields.status = status;
    if (agent_id) fields.agent_id = agent_id;
    if (status === "claimed") fields.claimed_at = new Date().toISOString();
    if (status === "completed" || status === "failed") fields.completed_at = new Date().toISOString();

    updateLaunchRequest(id, fields);

    // For standalone agents (no project_id) that have role/prompt metadata, deliver them now
    if (!projectMeta && agent_id && status === "completed" && existingRecord.agent_id) {
      try {
        const standaloneM = JSON.parse(existingRecord.agent_id as string) as Record<string, unknown>;
        if (standaloneM && typeof standaloneM === "object" && !standaloneM.project_id) {
          const db = getDb();
          if (standaloneM.role && typeof standaloneM.role === "string") {
            db.prepare("UPDATE agents SET role = ? WHERE id = ?").run(standaloneM.role, agent_id);
            logger.info({ agent_id }, "Set standalone agent role from launch request");
          }
          if (standaloneM.prompt && typeof standaloneM.prompt === "string") {
            addMessage(agent_id, standaloneM.prompt);
            logger.info({ agent_id }, "Sent standalone agent task prompt via message");
          }
        }
      } catch {
        // Not JSON or missing fields — ignore
      }
    }

    // If we have project metadata and the real agent_id, link the agent to the project
    if (projectMeta && agent_id && status === "completed") {
      try {
        const agent = getAgent(agent_id);
        if (agent) {
          const agentFields: Record<string, unknown> = {};
          if (projectMeta.project_id) (agentFields as Record<string, string>).project_id = projectMeta.project_id;
          if (projectMeta.role) (agentFields as Record<string, string>).role = projectMeta.role;
          if (projectMeta.parent_agent_id) (agentFields as Record<string, string>).parent_agent_id = projectMeta.parent_agent_id;

          // Use raw SQL since updateAgent doesn't know about project fields yet
          const db = getDb();
          db.prepare("UPDATE agents SET project_id = ?, role = ?, parent_agent_id = ? WHERE id = ?")
            .run(projectMeta.project_id || null, projectMeta.role || null, projectMeta.parent_agent_id || null, agent_id);

          // If this is a PM agent, link it to the project and send prompts via messages
          if (projectMeta.role === "PM" && projectMeta.project_id) {
            updateProject(projectMeta.project_id, { pm_agent_id: agent_id });

            // Send the PM system prompt as a pending message (includes project name, description, and all capabilities)
            const meta = projectMeta as Record<string, unknown>;
            if (meta.pm_prompt) {
              addMessage(agent_id, meta.pm_prompt as string);
              logger.info({ agent_id }, "Sent PM prompt via message");
            }
          }

          // If this is a sub-agent, send its task prompt as a message
          if (projectMeta.role !== "PM" && projectMeta.prompt) {
            addMessage(agent_id, projectMeta.prompt);
            logger.info({ agent_id, role: projectMeta.role }, "Sent sub-agent task prompt via message");
          }

          logger.info({ agent_id, projectMeta }, "Linked agent to project from launch request");
        }
      } catch (linkErr) {
        logger.error({ linkErr, agent_id, projectMeta }, "Failed to link agent to project");
      }
    }

    const updated = getLaunchRequest(id);
    broadcast("launch-request-updated", updated);
    res.json({ ok: true, request: updated });
  } catch (err) {
    logger.error({ err }, "Error updating launch request");
    res.status(500).json({ error: "Failed to update launch request" });
  }
});

export default router;
