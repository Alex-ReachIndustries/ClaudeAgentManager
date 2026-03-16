import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import agentsRouter from "./routes/agents.js";
import { addClient, removeClient, broadcast } from "./sse.js";
import { archiveInactiveAgents, getAgent } from "./db.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// SSE endpoint — must be before compression middleware to avoid buffering
app.get("/api/events", (req, res) => {
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

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Agent Manager backend listening on port ${PORT}`);

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
