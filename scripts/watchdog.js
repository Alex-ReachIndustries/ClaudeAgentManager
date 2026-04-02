#!/usr/bin/env node
/**
 * Agent Watchdog v3 — Reliable overnight agent persistence
 *
 * Monitors all agents at the process level and ensures they stay alive.
 * Designed to run alongside the launcher and handle:
 *
 *   1. Process-level monitoring (actual PID checks every 30s)
 *   2. Rate limit / session dialog detection with targeted SendKeys
 *   3. MQTT sidecar health monitoring
 *   4. Session expiry handling with recovery limits
 *   5. Graceful shutdown
 *
 * Auto-discovers backend URL from ~/.claude/agent-server-url
 * and API key from ~/.claude/agent-manager-key.
 *
 * Run:
 *   node scripts/watchdog.js
 *   (or) SERVER_URL=http://localhost:3001 node scripts/watchdog.js
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_INTERVAL = 30 * 1000;           // 30s — process-level checks
const STUCK_THRESHOLD = 5 * 60 * 1000;      // 5 min without update = possibly stuck
const DEAD_THRESHOLD = 10 * 60 * 1000;      // 10 min without update = likely dead
const POST_RESTART_GRACE = 2 * 60 * 1000;   // 2 min grace after restart
const MAX_RECOVERY_ATTEMPTS = 5;            // max auto-recoveries per agent
const SIDECAR_CHECK_INTERVAL = 60 * 1000;   // 60s — sidecar health checks
const HOURLY_SWEEP_MARGIN = 2 * 60 * 1000;  // start sweep 2 min after hour
const SENDKEYS_RETRY_WAIT = 30 * 1000;      // 30s wait after Enter before escalating

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Track agents we've recently restarted (agentId -> { restartedAt, recoveryCount })
const recentRestarts = new Map();

// Track agents where we sent Enter keys (agentId -> { sentAt })
const enterKeySent = new Map();

// Track known sidecar PIDs (agentId -> pid)
const knownSidecars = new Map();

// Shutdown flag
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Server URL / API key auto-discovery
// ---------------------------------------------------------------------------

function discoverServerUrl() {
  // Priority: env var > CLI arg > file > default
  if (process.env.SERVER_URL) return process.env.SERVER_URL;

  const idx = process.argv.indexOf('--server');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];

  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    const urlFile = path.join(home, '.claude', 'agent-server-url');
    return fs.readFileSync(urlFile, 'utf8').trim();
  } catch {
    return 'http://localhost:3001';
  }
}

function discoverApiKey() {
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];

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
// HTTP helpers (Node 22+ built-in fetch)
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
  return fetchJSON(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Process monitoring (PowerShell)
// ---------------------------------------------------------------------------

/**
 * Check if a specific PID is alive.
 */
async function isProcessAlive(pid) {
  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
      { timeout: 5000 }
    );
    return stdout.trim() === String(pid);
  } catch {
    return false;
  }
}

/**
 * Get all running claude.exe processes with their PIDs and parent PIDs.
 * Returns array of { pid, parentPid, sessionName }.
 */
async function getClaudeProcesses() {
  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "Get-Process -Name claude -ErrorAction SilentlyContinue | Select-Object Id, @{N='ParentId';E={(Get-CimInstance Win32_Process -Filter \\"ProcessId=$($_.Id)\\").ParentProcessId}} | ConvertTo-Json -Compress"`,
      { timeout: 10000 }
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '') return [];
    const parsed = JSON.parse(trimmed);
    // PowerShell returns a single object (not array) when there's only one process
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Find node.exe processes that are running mqtt-bridge.js for a specific agent.
 * Returns the PID if found, null otherwise.
 */
async function findSidecarProcess(agentId) {
  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'mqtt-bridge' -and $_.CommandLine -match '${agentId.substring(0, 8)}' } | Select-Object -ExpandProperty ProcessId"`,
      { timeout: 10000 }
    );
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Send Enter keys to a specific process window (targeted, not broadcast).
 */
async function sendEnterToProcess(pid) {
  try {
    await execAsync(
      `powershell.exe -NoProfile -Command "` +
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `$wshell = New-Object -ComObject wscript.shell; ` +
        `$activated = $wshell.AppActivate(${pid}); ` +
        `if ($activated) { ` +
          `Start-Sleep -Milliseconds 300; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
          `Start-Sleep -Milliseconds 500; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
          `Start-Sleep -Milliseconds 500; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
        `} else { ` +
          `Write-Host 'ACTIVATE_FAILED'; ` +
        `}"`,
      { timeout: 15000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a typed string to a specific process window (for "continue" message).
 */
async function sendTextToProcess(pid, text) {
  try {
    // Escape special SendKeys characters
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}');
    await execAsync(
      `powershell.exe -NoProfile -Command "` +
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `$wshell = New-Object -ComObject wscript.shell; ` +
        `$activated = $wshell.AppActivate(${pid}); ` +
        `if ($activated) { ` +
          `Start-Sleep -Milliseconds 300; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('${escaped}'); ` +
          `Start-Sleep -Milliseconds 300; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
        `}"`,
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Agent state helpers
// ---------------------------------------------------------------------------

function parseAgentTimestamp(ts) {
  if (!ts) return 0;
  // Backend stores UTC timestamps without 'Z' suffix
  const str = ts.endsWith('Z') ? ts : ts + 'Z';
  return new Date(str).getTime();
}

function getRecoveryCount(agent) {
  try {
    const meta = JSON.parse(agent.metadata || '{}');
    return (meta.recovery_count || 0);
  } catch {
    return 0;
  }
}

function isActiveStatus(status) {
  return ['active', 'idle', 'working', 'waiting-for-input'].includes(status);
}

function isRecoverableStatus(status) {
  return ['archived', 'completed'].includes(status);
}

// ---------------------------------------------------------------------------
// Core monitoring loop
// ---------------------------------------------------------------------------

async function fetchAgents() {
  try {
    const data = await fetchJSON(`${SERVER_URL}/api/agents?limit=100`);
    return data.data || [];
  } catch (err) {
    if (!err.message.includes('ECONNREFUSED')) {
      log(`Failed to fetch agents: ${err.message}`);
    }
    return null;
  }
}

/**
 * Main check loop — runs every CHECK_INTERVAL (30s).
 *
 * For each agent that should be active:
 *   1. Verify its PID actually exists
 *   2. If PID dead -> trigger recovery
 *   3. If PID alive but no update in 5+ min -> stuck at dialog, send Enter
 *   4. If Enter was sent 30s+ ago and still stuck -> escalate
 */
async function checkAgents() {
  if (shuttingDown) return;

  const agents = await fetchAgents();
  if (!agents) return;

  const now = Date.now();
  const claudeProcs = await getClaudeProcesses();
  const claudePids = new Set(claudeProcs.map(p => p.Id));

  let activeCount = 0;
  let stuckCount = 0;
  let deadCount = 0;

  for (const agent of agents) {
    // Skip completed/archived agents unless they were recently restarted
    if (!isActiveStatus(agent.status)) {
      // Check if this is an agent we recently restarted that hasn't checked in yet
      const restart = recentRestarts.get(agent.id);
      if (restart && (now - restart.restartedAt) < POST_RESTART_GRACE) {
        // Still within grace period, skip
        continue;
      }
      continue;
    }

    activeCount++;

    const pid = agent.pid ? parseInt(String(agent.pid), 10) : null;
    const lastUpdate = parseAgentTimestamp(agent.last_update_at);
    const timeSinceUpdate = now - lastUpdate;

    // If agent posted an update very recently (<60s), it's alive — skip
    if (timeSinceUpdate < 60 * 1000) continue;

    // Check if we recently restarted this agent
    const restart = recentRestarts.get(agent.id);
    if (restart && (now - restart.restartedAt) < POST_RESTART_GRACE) {
      // Within grace period — don't interfere
      continue;
    }

    // --- Case 1: Agent has a PID and it's alive ---
    if (pid && claudePids.has(pid)) {
      if (timeSinceUpdate > STUCK_THRESHOLD) {
        stuckCount++;
        await handleStuckAgent(agent, pid, timeSinceUpdate);
      }
      continue;
    }

    // --- Case 2: Agent has a PID but it's dead ---
    if (pid && !claudePids.has(pid)) {
      // Double-check with a direct PID lookup (claude might have a different process name)
      const directAlive = await isProcessAlive(pid);
      if (directAlive) {
        if (timeSinceUpdate > STUCK_THRESHOLD) {
          stuckCount++;
          await handleStuckAgent(agent, pid, timeSinceUpdate);
        }
        continue;
      }

      deadCount++;
      logAgent(agent.id, `PID ${pid} is dead (status=${agent.status}, last update ${Math.round(timeSinceUpdate / 60000)}m ago)`);
      await handleDeadAgent(agent);
      continue;
    }

    // --- Case 3: Agent has no PID recorded but is marked active ---
    if (!pid && timeSinceUpdate > DEAD_THRESHOLD) {
      deadCount++;
      logAgent(agent.id, `No PID recorded and no update for ${Math.round(timeSinceUpdate / 60000)}m — treating as dead`);
      await handleDeadAgent(agent);
    }
  }

  // Log summary only when there's something interesting
  if (stuckCount > 0 || deadCount > 0) {
    log(`Status: ${activeCount} active, ${stuckCount} stuck, ${deadCount} dead`);
  }
}

/**
 * Handle an agent that is alive but hasn't posted updates (stuck at dialog).
 */
async function handleStuckAgent(agent, pid, timeSinceUpdate) {
  const agentId = agent.id;

  // Check if we already sent Enter keys recently
  const enterState = enterKeySent.get(agentId);

  if (!enterState) {
    // First attempt: send Enter keys to dismiss dialog
    logAgent(agentId, `Stuck for ${Math.round(timeSinceUpdate / 60000)}m — sending Enter keys to PID ${pid}`);
    const sent = await sendEnterToProcess(pid);
    if (sent) {
      enterKeySent.set(agentId, { sentAt: Date.now(), attempts: 1 });
    }
    return;
  }

  const timeSinceEnter = Date.now() - enterState.sentAt;

  if (timeSinceEnter < SENDKEYS_RETRY_WAIT) {
    // Still waiting for Enter to take effect
    return;
  }

  // Enter didn't work — escalate
  if (enterState.attempts < 3) {
    // Try sending Enter again (dialog might have multiple prompts)
    logAgent(agentId, `Still stuck after Enter (attempt ${enterState.attempts}) — retrying Enter keys`);
    await sendEnterToProcess(pid);
    enterKeySent.set(agentId, { sentAt: Date.now(), attempts: enterState.attempts + 1 });
    return;
  }

  // After 3 Enter attempts, try sending "continue" as a typed message via API
  if (enterState.attempts === 3) {
    logAgent(agentId, `Enter keys failed 3 times — sending "/session-resume" via API`);
    try {
      await postJSON(`${SERVER_URL}/api/agents/${agentId}/messages`, {
        content: '/session-resume',
        source: 'system',
      });
      enterKeySent.set(agentId, { sentAt: Date.now(), attempts: 4 });
    } catch (err) {
      logAgent(agentId, `Failed to send API message: ${err.message}`);
    }
    return;
  }

  // After API message attempt, try typing "continue" directly into terminal
  if (enterState.attempts === 4) {
    logAgent(agentId, `API message didn't help — typing "continue" into terminal`);
    await sendTextToProcess(pid, 'continue');
    enterKeySent.set(agentId, { sentAt: Date.now(), attempts: 5 });
    return;
  }

  // All attempts exhausted — agent is unrecoverable while alive
  if (timeSinceUpdate > DEAD_THRESHOLD * 2) {
    logAgent(agentId, `Stuck beyond recovery with live process — killing and restarting`);
    try {
      // Kill the stuck process via the backend terminate flow
      await postJSON(`${SERVER_URL}/api/agents/${agentId}/close`, {});
    } catch (err) {
      logAgent(agentId, `Failed to close agent: ${err.message}`);
    }
    enterKeySent.delete(agentId);
    // handleDeadAgent will pick this up on next cycle
  }
}

/**
 * Handle an agent whose process is dead — attempt recovery via backend API.
 */
async function handleDeadAgent(agent) {
  const agentId = agent.id;
  const recoveryCount = getRecoveryCount(agent);

  // Clear any Enter key tracking
  enterKeySent.delete(agentId);

  // Check recovery limits
  if (recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
    logAgent(agentId, `Recovery count ${recoveryCount} >= max ${MAX_RECOVERY_ATTEMPTS} — marking as archived (failed)`);
    try {
      await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'archived',
          metadata: JSON.stringify({
            ...JSON.parse(agent.metadata || '{}'),
            watchdog_failed: true,
            watchdog_failed_at: new Date().toISOString(),
            watchdog_reason: `Exceeded max recovery attempts (${MAX_RECOVERY_ATTEMPTS})`,
          }),
        }),
      });
    } catch (err) {
      logAgent(agentId, `Failed to mark as failed: ${err.message}`);
    }
    return;
  }

  // Check if there's already a pending resume launch request for this agent
  try {
    const pendingRequests = await fetchJSON(`${SERVER_URL}/api/launch-requests?status=pending`);
    if (Array.isArray(pendingRequests)) {
      const existingResume = pendingRequests.find(
        r => r.type === 'resume' && r.resume_agent_id === agentId
      );
      if (existingResume) {
        logAgent(agentId, `Resume launch request #${existingResume.id} already pending — skipping`);
        return;
      }
    }
  } catch {
    // If we can't check, proceed with recovery (dedup is not critical)
  }

  // Close the agent first (marks as completed), then resume
  logAgent(agentId, `Triggering recovery (attempt ${recoveryCount + 1}/${MAX_RECOVERY_ATTEMPTS})`);

  try {
    // Update metadata with recovery count before close/resume
    const meta = JSON.parse(agent.metadata || '{}');
    await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: JSON.stringify({
          ...meta,
          recovery_count: recoveryCount + 1,
          last_recovery_at: new Date().toISOString(),
          watchdog_recovery: true,
        }),
      }),
    });

    // Close the agent (sets status=completed, creates terminate launch request if PID exists)
    await postJSON(`${SERVER_URL}/api/agents/${agentId}/close`, {});

    // Small delay to let terminate propagate
    await new Promise(r => setTimeout(r, 1000));

    // Resume the agent (creates a resume launch request for the launcher to pick up)
    const result = await postJSON(`${SERVER_URL}/api/agents/${agentId}/resume`, {});
    logAgent(agentId, `Resume requested: ${JSON.stringify(result)}`);

    // Track the restart
    recentRestarts.set(agentId, {
      restartedAt: Date.now(),
      recoveryCount: recoveryCount + 1,
    });
  } catch (err) {
    logAgent(agentId, `Recovery failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Hourly sweep — on the hour when rate limits reset
// ---------------------------------------------------------------------------

/**
 * Do a comprehensive sweep of ALL agents when rate limits reset.
 * Sends Enter keys to every stuck process and triggers recovery for dead ones.
 */
async function hourlySweep() {
  if (shuttingDown) return;

  log('=== Hourly sweep: rate limits resetting ===');

  const agents = await fetchAgents();
  if (!agents) return;

  const claudeProcs = await getClaudeProcesses();
  const claudePids = new Set(claudeProcs.map(p => p.Id));
  const now = Date.now();
  let wokenCount = 0;

  for (const agent of agents) {
    if (!isActiveStatus(agent.status)) continue;

    const pid = agent.pid;
    const lastUpdate = parseAgentTimestamp(agent.last_update_at);
    const timeSinceUpdate = now - lastUpdate;

    const parsedPid = pid ? parseInt(String(pid), 10) : null;

    // Only sweep agents that appear stuck (3+ min without update)
    if (timeSinceUpdate < 3 * 60 * 1000) continue;

    if (parsedPid && (claudePids.has(parsedPid) || await isProcessAlive(parsedPid))) {
      // Process alive but stuck — send Enter keys (rate limit dialog likely)
      logAgent(agent.id, `Hourly sweep: sending Enter keys (${Math.round(timeSinceUpdate / 60000)}m stuck)`);
      await sendEnterToProcess(parsedPid);
      wokenCount++;

      // Clear any escalation tracking — fresh start after hour
      enterKeySent.delete(agent.id);

      // Also send a "continue" message via API after a brief delay
      setTimeout(async () => {
        try {
          await postJSON(`${SERVER_URL}/api/agents/${agent.id}/messages`, {
            content: 'continue',
            source: 'system',
          });
          logAgent(agent.id, 'Hourly sweep: sent "continue" via API');
        } catch (err) {
          logAgent(agent.id, `Hourly sweep: failed to message: ${err.message}`);
        }
      }, 5000);
    }
    // Dead agents will be handled by the regular checkAgents cycle
  }

  log(`=== Hourly sweep complete: woke ${wokenCount} agent(s) ===`);
}

/**
 * Schedule the hourly sweep at HH:02 (2 minutes after the hour).
 * Rate limits on most APIs reset on the hour, so we wait a small margin.
 */
function scheduleHourlySweep() {
  const now = new Date();
  const minutesPast = now.getMinutes();
  const secondsPast = now.getSeconds();

  // Time until next HH:02:00
  let msUntilSweep;
  if (minutesPast < 2) {
    msUntilSweep = ((2 - minutesPast) * 60 - secondsPast) * 1000;
  } else {
    msUntilSweep = ((62 - minutesPast) * 60 - secondsPast) * 1000;
  }

  log(`Next hourly sweep in ${Math.round(msUntilSweep / 60000)} minutes`);

  setTimeout(() => {
    hourlySweep();
    // Then repeat every hour
    setInterval(hourlySweep, 60 * 60 * 1000);
  }, msUntilSweep);
}

// ---------------------------------------------------------------------------
// Sidecar monitoring
// ---------------------------------------------------------------------------

/**
 * Check MQTT sidecars for all active agents.
 * If a sidecar should be running but isn't, attempt to restart it.
 */
async function checkSidecars() {
  if (shuttingDown) return;

  const agents = await fetchAgents();
  if (!agents) return;

  for (const agent of agents) {
    if (!isActiveStatus(agent.status)) {
      // Clean up tracking for inactive agents
      knownSidecars.delete(agent.id);
      continue;
    }

    const agentId = agent.id;

    // Check if sidecar is running
    const knownPid = knownSidecars.get(agentId);
    let sidecarAlive = false;

    if (knownPid) {
      sidecarAlive = await isProcessAlive(knownPid);
    }

    if (!sidecarAlive) {
      // Try to find sidecar by scanning node processes
      const foundPid = await findSidecarProcess(agentId);
      if (foundPid) {
        knownSidecars.set(agentId, foundPid);
        sidecarAlive = true;
      }
    }

    if (!sidecarAlive) {
      logAgent(agentId, 'MQTT sidecar not running — requesting restart via launch request');

      // The launcher manages sidecar lifecycle via launch requests.
      // We create a resume launch request which the launcher handles
      // by spawning both the agent and its sidecar.
      // But first check if the agent process is actually alive — if so, we just
      // need the sidecar, not a full resume. In that case, restart it directly.
      const pid = agent.pid;
      const agentAlive = pid && await isProcessAlive(pid);

      if (agentAlive) {
        // Agent is alive, just sidecar is dead — restart sidecar directly
        try {
          const sidecarPath = path.join(__dirname, '..', 'sidecar', 'mqtt-bridge.js');
          if (fs.existsSync(sidecarPath)) {
            const { spawn } = require('child_process');
            const proc = spawn('node', [
              sidecarPath,
              '--agent', agentId,
              '--broker', process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
              '--username', 'agent',
              '--password', process.env.MQTT_AGENT_PASSWORD || 'agentsidecar',
            ], {
              detached: true,
              stdio: 'ignore',
            });
            proc.unref();
            knownSidecars.set(agentId, proc.pid);
            logAgent(agentId, `Restarted MQTT sidecar (PID ${proc.pid})`);
          }
        } catch (err) {
          logAgent(agentId, `Failed to restart sidecar: ${err.message}`);
        }
      }
      // If agent is also dead, the main check loop will handle full recovery
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup — expire old tracking data
// ---------------------------------------------------------------------------

function cleanupTracking() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 min

  for (const [agentId, info] of recentRestarts) {
    if (now - info.restartedAt > maxAge) {
      recentRestarts.delete(agentId);
    }
  }

  for (const [agentId, info] of enterKeySent) {
    if (now - info.sentAt > maxAge) {
      enterKeySent.delete(agentId);
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal} — shutting down gracefully`);

  // Clear all intervals
  for (const id of activeIntervals) {
    clearInterval(id);
  }
  for (const id of activeTimeouts) {
    clearTimeout(id);
  }

  log('Watchdog stopped');
  process.exit(0);
}

// Track intervals/timeouts for cleanup
const activeIntervals = [];
const activeTimeouts = [];

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Windows-specific: handle Ctrl+C on Windows
if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on('SIGINT', () => shutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  log('===================================');
  log('Agent Watchdog v3 starting');
  log('===================================');
  log(`Server: ${SERVER_URL}`);
  log(`API key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : '(none)'}`);
  log(`Check interval: ${CHECK_INTERVAL / 1000}s`);
  log(`Stuck threshold: ${STUCK_THRESHOLD / 60000}m`);
  log(`Dead threshold: ${DEAD_THRESHOLD / 60000}m`);
  log(`Post-restart grace: ${POST_RESTART_GRACE / 60000}m`);
  log(`Max recovery attempts: ${MAX_RECOVERY_ATTEMPTS}`);

  // Verify backend connectivity
  try {
    const health = await fetchJSON(`${SERVER_URL}/api/health`);
    log(`Backend health: ${health.status}`);
  } catch (err) {
    log(`WARNING: Cannot reach backend at ${SERVER_URL}: ${err.message}`);
    log('Will keep retrying...');
  }

  // Initial check
  await checkAgents();

  // Schedule recurring checks
  activeIntervals.push(setInterval(checkAgents, CHECK_INTERVAL));
  activeIntervals.push(setInterval(checkSidecars, SIDECAR_CHECK_INTERVAL));
  activeIntervals.push(setInterval(cleanupTracking, 5 * 60 * 1000));

  // Schedule hourly sweep
  scheduleHourlySweep();

  log('Monitoring active');
}

start().catch(err => {
  log(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
