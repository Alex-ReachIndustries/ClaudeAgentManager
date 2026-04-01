import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import { logger } from "./logger.js";
import agentsRouter from "./routes/agents.js";
import foldersRouter from "./routes/folders.js";
import launchRouter from "./routes/launch.js";
import pushRouter from "./routes/push.js";
import webhooksRouter from "./routes/webhooks.js";
import workflowsRouter from "./routes/workflows.js";
import retentionRouter from "./routes/retention.js";
import projectsRouter from "./routes/projects.js";
import { addClient, removeClient, broadcast, getClientCount } from "./sse.js";
import { archiveInactiveAgents, createLaunchRequest, getAgent, getDb, touchAgentHeartbeat, updateAgent } from "./db.js";
import { initPush } from "./push.js";
import { initWebhookDispatcher } from "./webhook-dispatcher.js";
import { initWorkflowEngine } from "./workflow-engine.js";
import { startRetentionScheduler } from "./retention.js";
import { initMqtt, setMqttHandlers } from "./mqtt.js";
import { authMiddleware, getApiKey } from "./middleware/auth.js";


const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const MAX_SSE_CLIENTS = 10;

// Trust proxy headers (X-Forwarded-Proto, etc.) from nginx/Tailscale Serve
app.set("trust proxy", true);

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));

// Auth middleware (enabled via AUTH_ENABLED=true env var)
app.use(authMiddleware);

// Health check (exempt from auth)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Database health endpoint
app.get("/api/health/db", (_req, res) => {
  try {
    const result = getDb().pragma("integrity_check") as { integrity_check: string }[];
    const ok = result[0]?.integrity_check === "ok";
    res.json({ status: ok ? "ok" : "error", details: result });
  } catch (err) {
    res.status(500).json({ status: "error", error: String(err) });
  }
});

// Auth key endpoints
app.get("/api/auth/key", (_req, res) => {
  res.json({ apiKey: getApiKey() });
});

app.post("/api/auth/rotate", (_req, res) => {
  const { rotateApiKey } = require("./middleware/auth.js");
  const newKey = rotateApiKey();
  res.json({ apiKey: newKey });
});

// SSE endpoint — must be before compression middleware to avoid buffering
app.get("/api/events", (req, res) => {
  if (getClientCount() >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: "Too many SSE connections" });
    return;
  }

  // Disable any compression for this response
  res.setHeader("X-Accel-Buffering", "no");
  addClient(res);

  req.on("close", () => {
    removeClient(res);
  });
});

// Compression for all other routes
app.use(compression());

// Routes
app.use("/api/agents", agentsRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/launch-requests", launchRouter);
app.use("/api/push", pushRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/workflows", workflowsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/retention", retentionRouter);

const server = app.listen(PORT, () => {
  logger.info(`Agent Manager backend listening on port ${PORT}`);

  // Initialize API key (generates on first run)
  const apiKey = getApiKey();
  const authEnabled = process.env.AUTH_ENABLED === "true";
  logger.info(`Auth: ${authEnabled ? "ENABLED" : "DISABLED (set AUTH_ENABLED=true to enable)"}`);
  logger.info(`API Key: ${apiKey}`);

  // Initialize Web Push (generates VAPID keys on first run)
  initPush();

  // Initialize webhook dispatcher
  initWebhookDispatcher();

  // Initialize workflow engine
  initWorkflowEngine();

  // Start retention scheduler
  startRetentionScheduler();

  // Initialize MQTT bridge (non-blocking — continues if broker unavailable)
  initMqtt();

  // Set MQTT handlers for agent updates received via MQTT
  setMqttHandlers({
    onHeartbeat: (agentId) => {
      try {
        touchAgentHeartbeat(agentId);
        // Auto-unarchive if needed
        const agent = getAgent(agentId);
        if (agent && (agent as Record<string, unknown>).status === "archived") {
          updateAgent(agentId, { status: "active" });
          broadcast("agent-updated", getAgent(agentId));
        }
      } catch { /* ignore */ }
    },
  });

  // Periodic sweep: archive agents inactive for >30 minutes, every 5 minutes
  setInterval(() => {
    try {
      const archivedIds = archiveInactiveAgents(30);
      for (const id of archivedIds) {
        const agent = getAgent(id);
        if (agent) broadcast("agent-updated", agent);
        logger.info(`Auto-archived inactive agent: ${id}`);
      }
    } catch (err) {
      logger.error({ err }, "Error in archive sweep");
    }

    // Auto-recovery: resume PM agents of active projects that were archived
    try {
      const db = getDb();
      const staleProjectPMs = db.prepare(`
        SELECT a.id, a.cwd, a.metadata, p.id AS project_id, p.name AS project_name
        FROM agents a
        JOIN projects p ON p.pm_agent_id = a.id
        WHERE a.status = 'archived'
          AND p.status = 'active'
      `).all() as { id: string; cwd: string | null; metadata: string | null; project_id: string; project_name: string }[];

      for (const pm of staleProjectPMs) {
        // Check recovery attempts to prevent infinite loops (max 3)
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(pm.metadata || "{}"); } catch { /* ignore */ }
        const recoveryCount = (meta.recovery_count as number) || 0;
        if (recoveryCount >= 3) {
          logger.warn(`PM agent ${pm.id} for project "${pm.project_name}" exceeded max recovery attempts (${recoveryCount})`);
          continue;
        }

        // Create resume launch request
        const cwd = pm.cwd || "";
        createLaunchRequest("resume", cwd, pm.id);
        updateAgent(pm.id, {
          status: "active",
          metadata: JSON.stringify({ ...meta, recovery_count: recoveryCount + 1, last_recovery_at: new Date().toISOString() }),
        });

        const agent = getAgent(pm.id);
        if (agent) broadcast("agent-updated", agent);
        logger.info(`Auto-recovery: resuming PM agent ${pm.id} for project "${pm.project_name}" (attempt ${recoveryCount + 1}/3)`);
      }
    } catch (err) {
      logger.error({ err }, "Error in auto-recovery sweep");
    }
  }, 5 * 60 * 1000);
});

// Feature 7: Graceful shutdown
function shutdown() {
  logger.info("Shutting down gracefully...");
  server.close();
  broadcast("shutdown", { reason: "server-restart" });
  setTimeout(() => {
    try {
      const db = getDb();
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    }
    process.exit(0);
  }, 20000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
