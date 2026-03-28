import { z } from "zod";

const agentStatuses = [
  "active",
  "idle",
  "working",
  "waiting-for-input",
  "completed",
  "archived",
] as const;

const updateTypes = [
  "text",
  "progress",
  "diagram",
  "error",
  "status",
] as const;

// --- Agent updates (POST /agents/:id/updates) ---

export const updateSchema = z.object({
  type: z.enum(updateTypes).default("status"),
  content: z
    .union([z.string().max(1_048_576), z.record(z.unknown())])
    .transform((v) => (typeof v === "string" ? v : JSON.stringify(v))),
  summary: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  status: z.enum(agentStatuses).optional(),
  projects: z.array(z.unknown()).optional(),
  todos: z.array(z.unknown()).optional(),
  workspace: z.string().max(500).optional(),
  cwd: z.string().max(500).optional(),
  pid: z.number().int().positive().optional(),
});

// --- Messages (POST /agents/:id/messages) ---

export const messageSchema = z.object({
  content: z.string().min(1).max(65_536).trim(),
});

// --- Agent patch (PATCH /agents/:id) ---

export const agentPatchSchema = z.object({
  title: z.string().max(200).optional(),
  status: z.enum(agentStatuses).optional(),
  metadata: z.string().max(262_144).optional(),
  poll_delay_until: z.string().nullable().optional(),
  workspace: z.string().max(500).optional(),
  cwd: z.string().max(500).optional(),
  pid: z.number().int().positive().nullable().optional(),
});

// --- Launch requests (POST /launch-requests) ---

export const launchRequestSchema = z.object({
  type: z.enum(["new", "resume", "terminate"]),
  folder_path: z.string().max(500).optional(),
  resume_agent_id: z.string().max(100).optional(),
  target_pid: z.number().int().positive().optional(),
});

// --- Push subscriptions (POST /push/subscribe) ---

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().max(500),
    auth: z.string().max(500),
  }),
});

// --- Push unsubscribe (POST /push/unsubscribe) ---

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});
