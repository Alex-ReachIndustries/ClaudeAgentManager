#!/usr/bin/env node
/**
 * MQTT Sidecar — Agent Message Bridge
 *
 * Subscribes to MQTT topics for a specific agent and writes incoming
 * messages to a local inbox file. Claude's polling cron reads this
 * file instead of making HTTP requests, reducing latency from 60s to <5s.
 *
 * Usage:
 *   node mqtt-bridge.js --agent <UUID> [--broker mqtt://localhost:1883] [--inbox ~/.claude/mqtt-inbox.json]
 *
 * The sidecar:
 *   1. Connects to the MQTT broker with agent credentials
 *   2. Subscribes to agents/{id}/messages
 *   3. On message: appends to inbox JSON file
 *   4. Claude's cron reads + clears the inbox file
 *
 * Inbox file format:
 *   { "messages": [ { "content": "...", "source": "user", "timestamp": "..." }, ... ] }
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- CLI args ---
function getArg(name, defaultVal) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

const AGENT_ID = getArg('agent', process.env.AGENT_ID || '');
const BROKER_URL = getArg('broker', process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883');
const USERNAME = getArg('username', process.env.MQTT_USERNAME || 'agent');
const PASSWORD = getArg('password', process.env.MQTT_PASSWORD || 'agentsidecar');
const INBOX_PATH = getArg('inbox', path.join(os.homedir(), '.claude', 'mqtt-inbox.json'));

if (!AGENT_ID) {
  console.error('Error: --agent <UUID> is required');
  console.error('Usage: node mqtt-bridge.js --agent <UUID> [--broker mqtt://host:1883]');
  process.exit(1);
}

// --- Inbox file management ---
function readInbox() {
  try {
    if (fs.existsSync(INBOX_PATH)) {
      const data = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf8'));
      return data.messages || [];
    }
  } catch {
    // Corrupted file — start fresh
  }
  return [];
}

function writeInbox(messages) {
  const dir = path.dirname(INBOX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INBOX_PATH, JSON.stringify({ messages, updated: new Date().toISOString() }, null, 2));
}

function appendMessage(msg) {
  const messages = readInbox();
  messages.push(msg);
  writeInbox(messages);
  log(`Message queued (${messages.length} pending): ${msg.content.substring(0, 60)}...`);
}

// --- Logging ---
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [mqtt-bridge] ${msg}`);
}

// --- MQTT connection ---
log(`Connecting to ${BROKER_URL} as agent ${AGENT_ID.substring(0, 8)}...`);

const client = mqtt.connect(BROKER_URL, {
  username: USERNAME,
  password: PASSWORD,
  clientId: `agent-sidecar-${AGENT_ID.substring(0, 8)}-${Date.now()}`,
  clean: true,
  connectTimeout: 10000,
  reconnectPeriod: 5000,
});

client.on('connect', () => {
  log('Connected to MQTT broker');

  // Subscribe to this agent's message topic
  const topic = `agents/${AGENT_ID}/messages`;
  client.subscribe(topic, { qos: 1 }, (err) => {
    if (err) {
      log(`Subscribe error: ${err.message}`);
    } else {
      log(`Subscribed to ${topic}`);
    }
  });

  // Also subscribe to system broadcasts
  client.subscribe('system/broadcast', { qos: 1 });

  // Start publishing heartbeats every 30 seconds
  setInterval(() => {
    if (client.connected) {
      client.publish(`agents/${AGENT_ID}/heartbeat`, JSON.stringify({
        timestamp: new Date().toISOString(),
      }), { qos: 0 });
    }
  }, 30000);
  log('Heartbeat publishing started (every 30s)');
});

client.on('message', (topic, payload) => {
  try {
    const msg = JSON.parse(payload.toString());

    if (topic === 'system/broadcast') {
      log(`Broadcast: ${msg.content}`);
      appendMessage({ ...msg, source: 'system' });
    } else {
      // Agent message
      appendMessage({
        content: msg.content,
        source: msg.source || 'user',
        source_agent_id: msg.source_agent_id || null,
        timestamp: msg.timestamp || new Date().toISOString(),
      });
    }
  } catch (err) {
    log(`Error processing message: ${err.message}`);
  }
});

client.on('error', (err) => {
  log(`MQTT error: ${err.message}`);
});

client.on('close', () => {
  log('Disconnected from broker (will reconnect)');
});

client.on('reconnect', () => {
  log('Reconnecting...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  client.end(false, () => {
    log('Disconnected');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log('Terminating...');
  client.end(false, () => process.exit(0));
});

log(`Inbox file: ${INBOX_PATH}`);
log('Waiting for messages...');
