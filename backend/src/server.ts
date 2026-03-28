import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import agentsRouter from "./routes/agents.js";
import foldersRouter from "./routes/folders.js";
import launchRouter from "./routes/launch.js";
import pushRouter from "./routes/push.js";
import { addClient, removeClient, broadcast, getClientCount } from "./sse.js";
import { archiveInactiveAgents, getAgent } from "./db.js";
import { initPush } from "./push.js";
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

// Auth middleware (enabled via AUTH_ENABLED=true env var)
app.use(authMiddleware);

// Health check (exempt from auth)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
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

app.listen(PORT, () => {
  console.log(`Agent Manager backend listening on port ${PORT}`);

  // Initialize API key (generates on first run)
  const apiKey = getApiKey();
  const authEnabled = process.env.AUTH_ENABLED === "true";
  console.log(`Auth: ${authEnabled ? "ENABLED" : "DISABLED (set AUTH_ENABLED=true to enable)"}`);
  console.log(`API Key: ${apiKey}`);

  // Initialize Web Push (generates VAPID keys on first run)
  initPush();

  // Periodic sweep: archive agents inactive for >30 minutes, every 5 minutes
  setInterval(() => {
    try {
      const archivedIds = archiveInactiveAgents(30);
      for (const id of archivedIds) {
        const agent = getAgent(id);
        if (agent) broadcast("agent-updated", agent);
        console.log(`Auto-archived inactive agent: ${id}`);
      }
    } catch (err) {
      console.error("Error in archive sweep:", err);
    }
  }, 5 * 60 * 1000);
});
