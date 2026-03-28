import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { validate } from "../middleware/validate.js";
import { workflowCreateSchema, workflowUpdateSchema } from "../schemas.js";
import { startWorkflow, pauseWorkflow } from "../workflow-engine.js";
import { logger } from "../logger.js";
import crypto from "node:crypto";

const router = Router();

/** Extract a route param as a string */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

// GET / — list all workflows
router.get("/", (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const workflows = db.prepare("SELECT * FROM workflows ORDER BY created_at DESC").all();
    res.json(workflows);
  } catch (err) {
    logger.error({ err }, "Error listing workflows");
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

// POST / — create a workflow
router.post("/", validate(workflowCreateSchema), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, steps, metadata } = req.body;
    const id = crypto.randomUUID();

    // Ensure each step has all fields with defaults
    const normalizedSteps = steps.map((step: Record<string, unknown>) => ({
      name: step.name || "Unnamed Step",
      folder_path: step.folder_path || "",
      prompt: step.prompt || "",
      trigger: step.trigger || "on_complete",
      condition: step.condition ?? null,
      agent_id: step.agent_id ?? null,
      status: step.status || "pending",
    }));

    db.prepare(
      "INSERT INTO workflows (id, name, steps, metadata) VALUES (?, ?, ?, ?)"
    ).run(id, name, JSON.stringify(normalizedSteps), JSON.stringify(metadata || {}));

    const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    res.status(201).json(workflow);
  } catch (err) {
    logger.error({ err }, "Error creating workflow");
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

// GET /:id — get a workflow with status
router.get("/:id", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");

    const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    res.json(workflow);
  } catch (err) {
    logger.error({ err }, "Error getting workflow");
    res.status(500).json({ error: "Failed to get workflow" });
  }
});

// POST /:id/start — begin workflow execution
router.post("/:id/start", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const result = startWorkflow(id);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const db = getDb();
    const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    res.json({ ok: true, workflow });
  } catch (err) {
    logger.error({ err }, "Error starting workflow");
    res.status(500).json({ error: "Failed to start workflow" });
  }
});

// POST /:id/pause — pause workflow execution
router.post("/:id/pause", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const result = pauseWorkflow(id);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const db = getDb();
    const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    res.json({ ok: true, workflow });
  } catch (err) {
    logger.error({ err }, "Error pausing workflow");
    res.status(500).json({ error: "Failed to pause workflow" });
  }
});

// DELETE /:id — delete a workflow
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");

    const existing = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error deleting workflow");
    res.status(500).json({ error: "Failed to delete workflow" });
  }
});

export default router;
