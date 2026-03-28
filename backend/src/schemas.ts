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

// --- Webhook create (POST /webhooks) ---

const webhookEvents = [
  "agent.completed",
  "agent.error",
  "agent.waiting",
  "agent.status_changed",
  "message.received",
] as const;

export const webhookCreateSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(webhookEvents)).min(1),
});

// --- Webhook update (PATCH /webhooks/:id) ---

export const webhookUpdateSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(webhookEvents)).min(1).optional(),
  active: z.boolean().optional(),
});

// --- Agent relay (POST /agents/:id/relay) ---

export const relaySchema = z.object({
  target_agent_id: z.string().min(1).max(200),
  content: z.string().min(1).max(65_536).trim(),
});

// --- Workflow create (POST /workflows) ---

const workflowStepSchema = z.object({
  name: z.string().max(200),
  folder_path: z.string().max(500),
  prompt: z.string().max(65_536),
  trigger: z.enum(["on_complete"]).default("on_complete"),
  condition: z.string().max(500).nullable().optional(),
  agent_id: z.string().max(200).nullable().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]).default("pending"),
});

export const workflowCreateSchema = z.object({
  name: z.string().min(1).max(200),
  steps: z.array(workflowStepSchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});

// --- Workflow update (used internally) ---

export const workflowUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  steps: z.array(workflowStepSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// --- Retention settings (PATCH /retention/settings) ---

export const retentionSettingsSchema = z.object({
  retention_archive_days: z.number().int().min(1).max(365).optional(),
  retention_update_days: z.number().int().min(1).max(365).optional(),
  retention_message_days: z.number().int().min(1).max(365).optional(),
  retention_enabled: z.boolean().optional(),
  retention_dry_run: z.boolean().optional(),
});
