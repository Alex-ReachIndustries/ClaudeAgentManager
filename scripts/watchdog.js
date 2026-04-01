#!/usr/bin/env node
/**
 * Agent Watchdog — monitors registered agents and auto-resumes dead ones.
 *
 * Detects agents that stopped updating (likely hit session limits or crashed)
 * and creates resume launch requests after a cooldown period.
 *
 * Run alongside the launcher:
 *   node scripts/watchdog.js
 *
 * Environment:
 *   SERVER_URL - backend URL (default: http://localhost:3001)
 *   CHECK_INTERVAL - seconds between checks (default: 60)
 *   DEAD_THRESHOLD - minutes without update before considered dead (default: 10)
 *   RESUME_COOLDOWN - minutes to wait before resuming (default: 5)
 */

const { execSync } = require('child_process');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '60') * 1000;
const DEAD_THRESHOLD = parseInt(process.env.DEAD_THRESHOLD || '10');
const RESUME_COOLDOWN = parseInt(process.env.RESUME_COOLDOWN || '5');

// Track agents we've already scheduled for resume to avoid duplicates
const resumeScheduled = new Map(); // agentId -> timestamp when scheduled

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-GB');
  console.log(`[${ts}] [watchdog] ${msg}`);
}

async function fetchJSON(url, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const apiKey = getApiKey();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
  return res.json();
}

function getApiKey() {
  try {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.USERPROFILE || process.env.HOME;
    return fs.readFileSync(path.join(home, '.claude', 'agent-manager-key'), 'utf8').trim();
  } catch {
    return '';
  }
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

async function checkAgents() {
  try {
    const data = await fetchJSON(`${SERVER_URL}/api/agents`);
    const agents = data.data || [];
    const now = Date.now();

    for (const agent of agents) {
      // Skip non-live agents
      if (['archived', 'completed'].includes(agent.status)) continue;

      // Skip self (the watchdog doesn't monitor itself)
      const lastUpdate = new Date(agent.last_update_at + 'Z').getTime();
      const minutesSinceUpdate = (now - lastUpdate) / 60000;

      // Skip recently active agents
      if (minutesSinceUpdate < DEAD_THRESHOLD) continue;

      // Skip if we already scheduled a resume recently
      const scheduledAt = resumeScheduled.get(agent.id);
      if (scheduledAt && (now - scheduledAt) < RESUME_COOLDOWN * 60000) {
        continue;
      }

      // Check if the process is actually dead
      const pid = agent.pid;
      if (pid && isProcessAlive(pid)) {
        // Process alive but not updating — might be stuck, not dead
        continue;
      }

      // Agent is dead — schedule resume after cooldown
      log(`Agent ${agent.id.substring(0, 8)} (${agent.title}) dead — no update for ${Math.round(minutesSinceUpdate)}min, PID ${pid || 'unknown'} not found`);

      // Wait cooldown then resume
      resumeScheduled.set(agent.id, now);
      setTimeout(async () => {
        try {
          log(`Resuming agent ${agent.id.substring(0, 8)}...`);

          // Close it first (so it can be resumed)
          await fetchJSON(`${SERVER_URL}/api/agents/${agent.id}/close`, { method: 'POST' });

          // Then resume
          const result = await fetchJSON(`${SERVER_URL}/api/agents/${agent.id}/resume`, { method: 'POST' });
          log(`Resume request created for ${agent.id.substring(0, 8)}: ${JSON.stringify(result)}`);

          // Clear from scheduled after successful resume
          setTimeout(() => resumeScheduled.delete(agent.id), 10 * 60000);
        } catch (err) {
          log(`Failed to resume ${agent.id.substring(0, 8)}: ${err.message}`);
          resumeScheduled.delete(agent.id);
        }
      }, RESUME_COOLDOWN * 60000);

      log(`Resume scheduled in ${RESUME_COOLDOWN} minutes`);
    }
  } catch (err) {
    log(`Check failed: ${err.message}`);
  }
}

// Start
log(`Watchdog started — checking every ${CHECK_INTERVAL / 1000}s, dead threshold ${DEAD_THRESHOLD}min, resume cooldown ${RESUME_COOLDOWN}min`);
log(`Server: ${SERVER_URL}`);

setInterval(checkAgents, CHECK_INTERVAL);
checkAgents(); // Initial check
