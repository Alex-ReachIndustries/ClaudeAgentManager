import fs from "fs";
import path from "path";
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
import rolesRouter from "./routes/roles.js";
import totpRouter from "./routes/totp.js";
import knowledgeRouter from "./routes/knowledge.js";
import { warmEmbeddings } from "./knowledge/embeddings.js";
import { startEmbedder } from "./knowledge/embedder.js";
import { addClient, removeClient, broadcast, getClientCount } from "./sse.js";
import { archiveInactiveAgents, getAgent, getDb, getFileByIdOnly, touchAgentHeartbeat, updateAgent } from "./db.js";
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
app.use("/api/roles", rolesRouter);
app.use("/api/totp", totpRouter);
app.use("/api/kb", knowledgeRouter);

// Failsafe: look up a file by ID alone (no agent_id required).
// Prevents 400 loops when agents call the wrong endpoint path (missing agent segment).
app.get("/api/files/:fileId", (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId, 10);
    if (isNaN(fileId)) { res.status(400).json({ error: "Invalid file ID" }); return; }
    const file = getFileByIdOnly(fileId);
    if (!file) { res.status(404).json({ error: "File not found" }); return; }
    if (file.file_path && fs.existsSync(file.file_path)) {
      res.setHeader("Content-Type", file.mimetype);
      res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
      res.sendFile(path.resolve(file.file_path));
    } else {
      res.status(404).json({ error: "File data not found on disk" });
    }
  } catch (err) {
    logger.error({ err }, "Error in failsafe file endpoint");
    res.status(500).json({ error: "Failed to retrieve file" });
  }
});

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

  // Knowledge Hub: warm the embedding model in the background and start the
  // background embedder that vectorizes stale entries/profiles.
  warmEmbeddings();
  startEmbedder();

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
