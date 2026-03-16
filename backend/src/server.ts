import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import agentsRouter from "./routes/agents.js";
import { addClient, removeClient } from "./sse.js";

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
});
