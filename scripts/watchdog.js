#!/usr/bin/env node
/**
 * Agent Watchdog v4 — Safe agent persistence with strong protections
 *
 * SAFETY RULES (hard guarantees):
 *   - NEVER close/kill an agent that posted an update in the last 5 minutes
 *   - NEVER set status to 'completed' (reserved for project agents)
 *   - NEVER create launch requests that open visible terminal windows
 *   - NEVER act on the same agent more than once per 5 minutes
 *   - NEVER create duplicate resume requests
 *   - ALL recovery actions are logged with reason
 *
 * What it does:
 *   1. Detects truly dead agents (PID gone + no update for 10+ min)
 *   2. Creates resume launch requests for dead agents (max 3 attempts)
 *   3. Sends Enter keys to stuck agents on the hourly sweep only
 *   4. Restarts dead MQTT sidecars (directly, no terminal windows)
 *
 * Run: node scripts/watchdog.js
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_INTERVAL = 60 * 1000;              // 60s between checks (not 30s)
const SAFE_THRESHOLD = 5 * 60 * 1000;          // 5 min — never touch agent within this
const DEAD_THRESHOLD = 10 * 60 * 1000;         // 10 min without update + dead PID = dead
const ACTION_COOLDOWN = 5 * 60 * 1000;         // 5 min cooldown between actions per agent
const MAX_RECOVERY_ATTEMPTS = 3;               // max 3 auto-recoveries (not 5)
const SIDECAR_CHECK_INTERVAL = 5 * 60 * 1000;  // 5 min between sidecar checks
const POST_RESTART_GRACE = 3 * 60 * 1000;      // 3 min grace after restart

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Per-agent cooldown tracking: agentId -> { lastAction: Date, type: string }
const actionCooldowns = new Map();

// Track recently restarted agents: agentId -> { restartedAt }
const recentRestarts = new Map();

// Track known sidecar PIDs: agentId -> pid
const knownSidecars = new Map();

let shuttingDown = false;

// ---------------------------------------------------------------------------
// Server URL / API key discovery
// ---------------------------------------------------------------------------

function discoverServerUrl() {
  if (process.env.SERVER_URL) return process.env.SERVER_URL;
  const idx = process.argv.indexOf('--server');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    return fs.readFileSync(path.join(home, '.claude', 'agent-server-url'), 'utf8').trim();
  } catch {
    return 'http://localhost:3001';
  }
}

function discoverApiKey() {
  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    return fs.readFileSync(path.join(home, '.claude', 'agent-manager-key'), 'utf8').trim();
  } catch {
    return '';
  }
}

const SERVER_URL = discoverServerUrl();
const API_KEY = discoverApiKey();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [watchdog] ${msg}`);
}

function logAgent(agentId, msg) {
  log(`[${agentId.substring(0, 8)}] ${msg}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function postJSON(url, body = {}) {
  return fetchJSON(url, { method: 'POST', body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Process monitoring
// ---------------------------------------------------------------------------

function parsePid(pid) {
  if (!pid) return null;
  const n = parseInt(String(pid), 10);
  return isNaN(n) ? null : n;
}

async function isProcessAlive(pid) {
  try {
    // Use tasklist (no PowerShell window flash) to check if PID exists
    const { stdout } = await execAsync(
      `tasklist /FI "PID eq ${pid}" /NH /FO CSV`,
      { timeout: 5000, windowsHide: true }
    );
    return stdout.includes(String(pid));
  } catch {
    return false;
  }
}

async function getClaudeProcesses() {
  try {
    // Use tasklist (no PowerShell window flash) to find claude.exe PIDs
    const { stdout } = await execAsync(
      `tasklist /FI "IMAGENAME eq claude.exe" /NH /FO CSV`,
      { timeout: 10000, windowsHide: true }
    );
    const pids = new Set();
    for (const line of stdout.split('\n')) {
      // CSV format: "claude.exe","12345","Console","1","12,345 K"
      const match = line.match(/"claude\.exe","(\d+)"/i);
      if (match) pids.add(parseInt(match[1], 10));
    }
    return pids;
  } catch {
    return new Set();
  }
}

// sendEnterToProcess removed — rate limits no longer show a dialog

// ---------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------

function parseTimestamp(ts) {
  if (!ts) return 0;
  const str = ts.endsWith('Z') ? ts : ts + 'Z';
  return new Date(str).getTime();
}

function isActiveStatus(status) {
  return ['active', 'idle', 'working', 'waiting-for-input'].includes(status);
}

/**
 * SAFETY: Check if we're allowed to take action on this agent.
 * Returns false if the agent is protected.
 */
function canActOnAgent(agentId, lastUpdateAt) {
  const now = Date.now();
  const timeSinceUpdate = now - parseTimestamp(lastUpdateAt);

  // HARD RULE: never touch an agent that updated in the last 5 minutes
  if (timeSinceUpdate < SAFE_THRESHOLD) return false;

  // HARD RULE: respect action cooldown
  const cooldown = actionCooldowns.get(agentId);
  if (cooldown && (now - cooldown.lastAction) < ACTION_COOLDOWN) return false;

  // HARD RULE: respect post-restart grace period
  const restart = recentRestarts.get(agentId);
  if (restart && (now - restart.restartedAt) < POST_RESTART_GRACE) return false;

  return true;
}

function recordAction(agentId, type) {
  actionCooldowns.set(agentId, { lastAction: Date.now(), type });
}

function getRecoveryCount(agent) {
  try {
    return JSON.parse(agent.metadata || '{}').recovery_count || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Core monitoring loop — runs every 60s
// ---------------------------------------------------------------------------

async function checkAgents() {
  if (shuttingDown) return;

  let agents;
  try {
    const data = await fetchJSON(`${SERVER_URL}/api/agents?limit=100`);
    agents = data.data || [];
  } catch (err) {
    if (!err.message.includes('ECONNREFUSED')) {
      log(`Failed to fetch agents: ${err.message}`);
    }
    return;
  }

  const claudePids = await getClaudeProcesses();
  let deadCount = 0;

  for (const agent of agents) {
    if (!isActiveStatus(agent.status)) continue;

    const pid = parsePid(agent.pid);
    const timeSinceUpdate = Date.now() - parseTimestamp(agent.last_update_at);

    // SAFETY: skip if agent updated recently
    if (!canActOnAgent(agent.id, agent.last_update_at)) continue;

    // Is the process alive?
    let processAlive = false;
    if (pid) {
      processAlive = claudePids.has(pid);
      if (!processAlive) {
        // Double-check with direct PID lookup
        processAlive = await isProcessAlive(pid);
      }
    }

    // Only act if process is DEAD and no update for DEAD_THRESHOLD
    if (!processAlive && timeSinceUpdate > DEAD_THRESHOLD) {
      deadCount++;
      logAgent(agent.id, `DEAD: PID ${pid || 'none'} gone, no update for ${Math.round(timeSinceUpdate / 60000)}m`);
      await handleDeadAgent(agent);
    }
    // If process is alive but stuck, we only handle that in hourly sweeps
  }

  if (deadCount > 0) {
    log(`Check complete: ${deadCount} dead agent(s) found`);
  }
}

/**
 * Handle a confirmed dead agent — attempt recovery via resume.
 */
async function handleDeadAgent(agent) {
  const agentId = agent.id;
  const recoveryCount = getRecoveryCount(agent);

  // SAFETY: check limits
  if (recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
    logAgent(agentId, `Recovery limit reached (${recoveryCount}/${MAX_RECOVERY_ATTEMPTS}) — archiving`);
    try {
      await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'archived',
          metadata: JSON.stringify({
            ...JSON.parse(agent.metadata || '{}'),
            watchdog_failed: true,
            watchdog_failed_at: new Date().toISOString(),
          }),
        }),
      });
    } catch (err) {
      logAgent(agentId, `Failed to archive: ${err.message}`);
    }
    recordAction(agentId, 'archive');
    return;
  }

  // SAFETY: check for existing pending resume requests
  try {
    const pending = await fetchJSON(`${SERVER_URL}/api/launch-requests?status=pending`);
    if (Array.isArray(pending)) {
      const existing = pending.find(r => r.type === 'resume' && r.resume_agent_id === agentId);
      if (existing) {
        logAgent(agentId, `Resume request #${existing.id} already pending — skipping`);
        recordAction(agentId, 'skip-dup');
        return;
      }
    }
  } catch { /* proceed if check fails */ }

  // Increment recovery count in metadata
  logAgent(agentId, `Recovery attempt ${recoveryCount + 1}/${MAX_RECOVERY_ATTEMPTS}`);
  try {
    const meta = JSON.parse(agent.metadata || '{}');
    await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: JSON.stringify({
          ...meta,
          recovery_count: recoveryCount + 1,
          last_recovery_at: new Date().toISOString(),
        }),
      }),
    });

    // Close then resume
    await postJSON(`${SERVER_URL}/api/agents/${agentId}/close`, {});
    await new Promise(r => setTimeout(r, 1000));
    const result = await postJSON(`${SERVER_URL}/api/agents/${agentId}/resume`, {});
    logAgent(agentId, `Resume launched (request #${result.launch_request_id || '?'})`);

    recentRestarts.set(agentId, { restartedAt: Date.now() });
    recordAction(agentId, 'resume');
  } catch (err) {
    logAgent(agentId, `Recovery failed: ${err.message}`);
    recordAction(agentId, 'error');
  }
}

// ---------------------------------------------------------------------------
// Hourly sweep removed — rate limits no longer show a dialog to dismiss

// ---------------------------------------------------------------------------
// Sidecar monitoring — runs every 5 minutes
// ---------------------------------------------------------------------------

async function checkSidecars() {
  if (shuttingDown) return;

  let agents;
  try {
    const data = await fetchJSON(`${SERVER_URL}/api/agents?limit=100`);
    agents = data.data || [];
  } catch { return; }

  for (const agent of agents) {
    if (!isActiveStatus(agent.status)) continue;

    const agentId = agent.id;
    const pid = parsePid(agent.pid);

    // Only restart sidecars for agents with live processes
    if (!pid || !(await isProcessAlive(pid))) continue;

    // Check if sidecar is running
    let sidecarAlive = false;
    const knownPid = knownSidecars.get(agentId);
    if (knownPid && typeof knownPid === 'number') {
      sidecarAlive = await isProcessAlive(knownPid);
    }

    if (!sidecarAlive) {
      // Scan for existing sidecar process (use wmic instead of PowerShell to avoid window flash)
      try {
        const { stdout } = await execAsync(
          `wmic process where "name='node.exe' and commandline like '%mqtt-bridge%' and commandline like '%${agentId.substring(0, 8)}%'" get processid /format:csv`,
          { timeout: 10000, windowsHide: true }
        );
        const foundPid = parseInt(stdout.trim(), 10);
        if (!isNaN(foundPid)) {
          knownSidecars.set(agentId, foundPid);
          sidecarAlive = true;
        }
      } catch { /* not found */ }
    }

    if (!sidecarAlive) {
      // Spawn sidecar directly (hidden, no terminal window)
      try {
        const sidecarDir = path.join(__dirname, '..', 'sidecar');
        const sidecarScript = path.join(sidecarDir, 'mqtt-bridge.js');
        if (fs.existsSync(sidecarScript)) {
          const proc = spawn('node', [
            'mqtt-bridge.js',
            '--agent', agentId,
            '--broker', process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
            '--username', 'agent',
            '--password', process.env.MQTT_AGENT_PASSWORD || 'agentsidecar',
          ], {
            cwd: sidecarDir,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          proc.unref();
          knownSidecars.set(agentId, proc.pid);
          logAgent(agentId, `Started MQTT sidecar (PID ${proc.pid})`);
        }
      } catch (err) {
        logAgent(agentId, `Sidecar start failed: ${err.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupTracking() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;

  for (const [id, info] of actionCooldowns) {
    if (now - info.lastAction > maxAge) actionCooldowns.delete(id);
  }
  for (const [id, info] of recentRestarts) {
    if (now - info.restartedAt > maxAge) recentRestarts.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

const activeIntervals = [];
const activeTimeouts = [];

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} — shutting down`);
  activeIntervals.forEach(clearInterval);
  activeTimeouts.forEach(clearTimeout);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => shutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  log('=== Agent Watchdog v4 ===');
  log(`Server: ${SERVER_URL}`);
  log(`Check interval: ${CHECK_INTERVAL / 1000}s`);
  log(`Safe threshold: ${SAFE_THRESHOLD / 60000}m (never touch within)`);
  log(`Dead threshold: ${DEAD_THRESHOLD / 60000}m`);
  log(`Action cooldown: ${ACTION_COOLDOWN / 60000}m per agent`);
  log(`Max recovery: ${MAX_RECOVERY_ATTEMPTS} attempts`);

  try {
    const health = await fetchJSON(`${SERVER_URL}/api/health`);
    log(`Backend: ${health.status}`);
  } catch (err) {
    log(`WARNING: Backend unreachable: ${err.message}`);
  }

  // Start monitoring
  activeIntervals.push(setInterval(checkAgents, CHECK_INTERVAL));
  activeIntervals.push(setInterval(checkSidecars, SIDECAR_CHECK_INTERVAL));
  activeIntervals.push(setInterval(cleanupTracking, 10 * 60 * 1000));

  // First check after 10s (let things settle)
  setTimeout(checkAgents, 10000);

  log('Monitoring active');
}

start().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
