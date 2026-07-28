/**
 * MQTT Client for the Dashboard
 *
 * Connects to Mosquitto broker via WebSocket (port 9001) and subscribes
 * to agent update/message topics. Provides the same event interface as
 * the SSE subscribeToEvents function for seamless integration.
 *
 * Falls back to SSE if MQTT connection fails.
 */
import mqtt from 'mqtt';
import type { SSEEvent } from './types';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';
type ConnectionListener = (state: ConnectionState) => void;

const connectionListeners = new Set<ConnectionListener>();

function notifyConnectionState(state: ConnectionState) {
  connectionListeners.forEach((fn) => fn(state));
}

export function onMqttConnectionChange(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => { connectionListeners.delete(listener); };
}

/**
 * Derive MQTT WebSocket URL from current page location.
 * Uses the /mqtt path proxied through Nginx, so it works through
 * Tailscale serve without exposing a separate port.
 */
function getMqttUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host; // includes port if non-standard
  return `${proto}://${host}/mqtt`;
}

/**
 * Subscribe to real-time events via MQTT WebSocket.
 *
 * Topics subscribed:
 *   agents/+/updates   — agent status updates
 *   agents/+/messages  — new messages queued for agents
 *   system/broadcast   — system-wide announcements
 *
 * Returns an unsubscribe function.
 */
export function subscribeToMqttEvents(
  onEvent: (event: SSEEvent) => void,
  onConnectionStateChange?: (state: ConnectionState) => void,
): () => void {
  const url = getMqttUrl();

  const emitState = (state: ConnectionState) => {
    notifyConnectionState(state);
    onConnectionStateChange?.(state);
  };

  emitState('connecting');

  const client = mqtt.connect(url, {
    username: 'dashboard',
    password: 'dashboard',
    clientId: `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    emitState('connected');

    // Subscribe to all agent topics
    client.subscribe([
      'agents/+/updates',
      'agents/+/messages',
      'system/broadcast',
    ], { qos: 0 });
  });

  client.on('error', () => {
    emitState('disconnected');
  });

  client.on('close', () => {
    emitState('disconnected');
  });

  client.on('reconnect', () => {
    emitState('connecting');
  });

  client.on('message', (topic: string, payload: Buffer) => {
    try {
      const data = JSON.parse(payload.toString());

      // Parse topic: agents/{id}/updates or agents/{id}/messages
      const parts = topic.split('/');

      if (parts[0] === 'agents' && parts[2] === 'updates') {
        if (data.type === 'terminal') {
          // Live terminal output — distinct shape from a full Agent object
          onEvent({ type: 'terminal-output', data: { agentId: parts[1], output: data.output, timestamp: data.timestamp } });
        } else {
          // Agent update — emit as agent-updated event
          onEvent({ type: 'agent-updated', data });
        }
      } else if (parts[0] === 'agents' && parts[2] === 'messages') {
        // Message queued — emit as message-queued event
        onEvent({ type: 'message-queued', data });
      }
      // system/broadcast could be handled here if needed
    } catch {
      // Ignore malformed messages
    }
  });

  return () => {
    client.end(true);
    emitState('disconnected');
  };
}

/**
 * Check if MQTT WebSocket is reachable by attempting a quick connection.
 * Returns true if connection succeeds within timeout.
 */
export async function isMqttAvailable(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = getMqttUrl();
    const timer = setTimeout(() => {
      client.end(true);
      resolve(false);
    }, timeoutMs);

    const client = mqtt.connect(url, {
      username: 'dashboard',
      password: 'dashboard',
      clientId: `probe-${Date.now()}`,
      clean: true,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0, // Don't reconnect for probe
    });

    client.on('connect', () => {
      clearTimeout(timer);
      client.end(true);
      resolve(true);
    });

    client.on('error', () => {
      clearTimeout(timer);
      client.end(true);
      resolve(false);
    });
  });
}
