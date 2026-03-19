import { Router, type Request, type Response } from "express";
import {
  createLaunchRequest,
  getLaunchRequestsByStatus,
  updateLaunchRequest,
  getLaunchRequest,
} from "../db.js";
import { broadcast } from "../sse.js";

const router = Router();

// POST / — create a new launch request
router.post("/", (req: Request, res: Response) => {
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

    const request = createLaunchRequest(type, folder_path || "", resume_agent_id);
    broadcast("launch-request-created", request);
    res.status(201).json({ ok: true, request });
  } catch (err) {
    console.error("Error creating launch request:", err);
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
    console.error("Error listing launch requests:", err);
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

    const fields: Record<string, string> = {};
    if (status) fields.status = status;
    if (agent_id) fields.agent_id = agent_id;
    if (status === "claimed") fields.claimed_at = new Date().toISOString();
    if (status === "completed" || status === "failed") fields.completed_at = new Date().toISOString();

    updateLaunchRequest(id, fields);

    const updated = getLaunchRequest(id);
    broadcast("launch-request-updated", updated);
    res.json({ ok: true, request: updated });
  } catch (err) {
    console.error("Error updating launch request:", err);
    res.status(500).json({ error: "Failed to update launch request" });
  }
});

export default router;
