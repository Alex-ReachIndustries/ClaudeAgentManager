/**
 * MQTT Bridge — publishes agent events to MQTT topics for real-time delivery.
 *
 * Topic structure:
 *   agents/{id}/messages   — dashboard→agent messages (backend publishes, agent sidecar subscribes)
 *   agents/{id}/updates    — agent status updates (for dashboard MQTT clients)
 *   agents/{id}/heartbeat  — agent liveness pings
 *   system/broadcast       — system-wide announcements
 */
import mqtt from "mqtt";
import { logger } from "./logger.js";

let client: mqtt.MqttClient | null = null;
let connected = false;

/**
 * Initialize MQTT connection. Call once at startup.
 * Non-blocking — if MQTT is unavailable, the system continues with HTTP-only.
 */
export function initMqtt(): void {
  const url = process.env.MQTT_URL;
  if (!url) {
    logger.info("MQTT_URL not set — MQTT bridge disabled");
    return;
  }

  const username = process.env.MQTT_USERNAME || "backend";
  const password = process.env.MQTT_PASSWORD || "claudemanager";

  logger.info({ url }, "Connecting to MQTT broker");

  client = mqtt.connect(url, {
    username,
    password,
    clientId: `claudemanager-backend-${Date.now()}`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    connected = true;
    logger.info("MQTT connected");

    // Subscribe to agent update topics for agents publishing via MQTT sidecar
    client!.subscribe("agents/+/updates/inbound", { qos: 1 }, (err) => {
      if (err) logger.error({ err }, "MQTT subscribe error");
      else logger.info("Subscribed to agents/+/updates/inbound");
    });

    // Subscribe to agent heartbeats
    client!.subscribe("agents/+/heartbeat", { qos: 0 }, (err) => {
      if (err) logger.error({ err }, "MQTT heartbeat subscribe error");
    });
  });

  client.on("message", (topic: string, payload: Buffer) => {
    try {
      const parts = topic.split("/");
      if (parts[0] !== "agents" || parts.length < 3) return;

      const agentId = parts[1];
      const action = parts[2];

      if (action === "heartbeat") {
        // Agent heartbeat via MQTT — touch the agent's last activity
        onMqttHeartbeat?.(agentId);
      } else if (action === "updates" && parts[3] === "inbound") {
        // Agent update published via MQTT sidecar
        const data = JSON.parse(payload.toString());
        onMqttUpdate?.(agentId, data);
      }
    } catch (err) {
      logger.error({ err }, "Error processing MQTT message");
    }
  });

  client.on("error", (err) => {
    logger.error({ err: err.message }, "MQTT error");
  });

  client.on("close", () => {
    connected = false;
    logger.warn("MQTT disconnected");
  });

  client.on("reconnect", () => {
    logger.info("MQTT reconnecting");
  });
}

// Callbacks for MQTT-received events (set by server.ts)
let onMqttUpdate: ((agentId: string, data: Record<string, unknown>) => void) | null = null;
let onMqttHeartbeat: ((agentId: string) => void) | null = null;

export function setMqttHandlers(handlers: {
  onUpdate?: (agentId: string, data: Record<string, unknown>) => void;
  onHeartbeat?: (agentId: string) => void;
}) {
  onMqttUpdate = handlers.onUpdate || null;
  onMqttHeartbeat = handlers.onHeartbeat || null;
}

/**
 * Publish a message to an agent's message topic.
 * Called when a message is created via the API (dashboard→agent or relay).
 */
export function publishAgentMessage(agentId: string, content: string, source: string, sourceAgentId?: string): void {
  if (!client || !connected) return;

  const payload = JSON.stringify({
    content,
    source,
    source_agent_id: sourceAgentId || null,
    timestamp: new Date().toISOString(),
  });

  client.publish(`agents/${agentId}/messages`, payload, { qos: 1 }, (err) => {
    if (err) logger.error({ err, agentId }, "MQTT publish message error");
  });
}

/**
 * Publish an agent status update.
 * Called when an agent posts an update via the API.
 */
export function publishAgentUpdate(agentId: string, update: Record<string, unknown>): void {
  if (!client || !connected) return;

  const payload = JSON.stringify({
    ...update,
    agent_id: agentId,
    timestamp: new Date().toISOString(),
  });

  client.publish(`agents/${agentId}/updates`, payload, { qos: 0 }, (err) => {
    if (err) logger.error({ err, agentId }, "MQTT publish update error");
  });
}

/**
 * Publish a system broadcast (e.g., shutdown notice).
 */
export function publishBroadcast(content: string): void {
  if (!client || !connected) return;

  client.publish("system/broadcast", JSON.stringify({ content, timestamp: new Date().toISOString() }), { qos: 1 });
}

/**
 * Get MQTT connection status.
 */
export function isMqttConnected(): boolean {
  return connected;
}

/**
 * Gracefully disconnect from MQTT.
 */
export function closeMqtt(): Promise<void> {
  return new Promise((resolve) => {
    if (client) {
      client.end(false, () => {
        logger.info("MQTT disconnected gracefully");
        resolve();
      });
    } else {
      resolve();
    }
  });
}
