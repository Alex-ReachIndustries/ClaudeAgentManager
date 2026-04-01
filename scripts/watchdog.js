#!/usr/bin/env node
/**
 * Agent Watchdog — monitors agents and auto-resumes after session limits.
 *
 * Session limits don't kill the process — they show a dialog and the agent
 * stops responding. Limits reset on the hour. This watchdog:
 *
 * 1. Every 60s: checks all agents for staleness (no update in 10+ min)
 * 2. If stale + process alive: kills the stuck process (it's at a limit dialog)
 * 3. On the hour: resumes all dead/killed agents (limits have reset)
 *
 * Run alongside the launcher:
 *   SERVER_URL=http://localhost:3001 node scripts/watchdog.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const CHECK_INTERVAL = 60 * 1000; // 60s
const DEAD_THRESHOLD = 10; // minutes without update = stale

// Agents killed and awaiting hourly resume
const pendingResume = new Map(); // agentId -> { title, cwd, killedAt }

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-GB');
  console.log(`[${ts}] [watchdog] ${msg}`);
}

function getApiKey() {
  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    return fs.readFileSync(path.join(home, '.claude', 'agent-manager-key'), 'utf8').trim();
  } catch {
    return '';
  }
}

async function fetchJSON(url, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      ...(options.headers || {}),
    },
  });
  return res.json();
}

function isProcessAlive(pid) {
  try {
    const result = execSync(
      `powershell.exe -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return result === String(pid);
  } catch {
    return false;
  }
}

function killProcess(pid) {
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
      { encoding: 'utf8', timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for stale agents — kill stuck ones so they can be resumed on the hour.
 */
async function checkAgents() {
  try {
    const data = await fetchJSON(`${SERVER_URL}/api/agents`);
    const agents = data.data || [];
    const now = Date.now();
    const myId = '272e57db-e4a1-4149-9a93-94533b40e22c'; // Cam's ID — don't kill self

    for (const agent of agents) {
      if (['archived', 'completed'].includes(agent.status)) continue;
      if (agent.id === myId) continue; // Don't kill myself

      const lastUpdate = new Date(agent.last_update_at + 'Z').getTime();
      const minutesSinceUpdate = (now - lastUpdate) / 60000;

      if (minutesSinceUpdate < DEAD_THRESHOLD) continue;
      if (pendingResume.has(agent.id)) continue; // Already killed, awaiting resume

      const pid = agent.pid;
      // Don't kill — the process is at a limit dialog. Let it stay alive
      // so we can send Enter keys on the hour to wake it up.
      const processAlive = pid && isProcessAlive(pid);

      // Mark for resume on the hour
      pendingResume.set(agent.id, {
        title: agent.title,
        cwd: agent.cwd || agent.workspace || '',
        pid: pid || null,
        processAlive,
        killedAt: now,
      });
      log(`Agent ${agent.id.substring(0, 8)} queued for hourly resume`);
    }
  } catch (err) {
    log(`Check error: ${err.message}`);
  }
}

function sendEnterToProcess(pid) {
  try {
    execSync(
      `powershell.exe -NoProfile -Command "` +
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$wshell = New-Object -ComObject wscript.shell; ` +
      `$wshell.AppActivate(${pid}); ` +
      `Start-Sleep -Milliseconds 300; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
      `Start-Sleep -Milliseconds 500; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
      `Start-Sleep -Milliseconds 500; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}');"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * On the hour: try to wake stuck agents (limits have reset).
 *
 * Strategy:
 * 1. If process still alive: send Enter keys to dismiss limit dialog, then
 *    send "continue" message via API so the agent knows to resume work
 * 2. If process dead: close and create a resume launch request
 */
async function hourlyResume() {
  if (pendingResume.size === 0) return;

  log(`Hourly resume: ${pendingResume.size} agent(s) to wake`);

  for (const [agentId, info] of pendingResume) {
    try {
      const pid = info.pid;

      if (pid && isProcessAlive(pid)) {
        // Process still alive — send Enter keys to dismiss limit dialog
        log(`Sending Enter keys to ${agentId.substring(0, 8)} (PID ${pid})...`);
        sendEnterToProcess(pid);

        // Wait a moment then send "continue" message via API
        setTimeout(async () => {
          try {
            await fetchJSON(`${SERVER_URL}/api/agents/${agentId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ content: 'continue' }),
            });
            log(`Sent "continue" message to ${agentId.substring(0, 8)}`);
          } catch (err) {
            log(`Failed to message ${agentId.substring(0, 8)}: ${err.message}`);
          }
        }, 5000);
      } else {
        // Process dead — close and resume via launcher
        log(`Process dead for ${agentId.substring(0, 8)} — closing and resuming`);
        await fetchJSON(`${SERVER_URL}/api/agents/${agentId}/close`, { method: 'POST' });
        const result = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}/resume`, { method: 'POST' });
        log(`Resume request for ${agentId.substring(0, 8)}: ${JSON.stringify(result)}`);
      }

      pendingResume.delete(agentId);
    } catch (err) {
      log(`Failed to wake ${agentId.substring(0, 8)}: ${err.message}`);
    }
  }
}

/**
 * Schedule hourly resume at the top of each hour.
 */
function scheduleHourlyResume() {
  const now = new Date();
  const msUntilNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;

  log(`Next hourly resume in ${Math.round(msUntilNextHour / 60000)} minutes`);

  setTimeout(() => {
    hourlyResume();
    // Then repeat every hour
    setInterval(hourlyResume, 60 * 60 * 1000);
  }, msUntilNextHour);
}

// Start
log('Watchdog started');
log(`Server: ${SERVER_URL}`);
log(`Check interval: ${CHECK_INTERVAL / 1000}s, dead threshold: ${DEAD_THRESHOLD}min`);
log(`Stale agents killed immediately, resumed on the hour (limit reset)`);

setInterval(checkAgents, CHECK_INTERVAL);
checkAgents();
scheduleHourlyResume();
