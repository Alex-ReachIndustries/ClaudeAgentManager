#!/usr/bin/env node
/**
 * Host-side Agent Launcher
 *
 * Runs on the Windows host (NOT in Docker). Polls the Agent Manager backend
 * for pending launch requests and spawns Claude terminal sessions.
 *
 * Usage: node launcher.js [--server https://msi.tail06903c.ts.net]
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

const SERVER_URL = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : 'https://msi.tail06903c.ts.net';

const API_KEY = process.argv.includes('--api-key')
  ? process.argv[process.argv.indexOf('--api-key') + 1]
  : (() => {
      try { return require('fs').readFileSync(path.join(os.homedir(), '.claude', 'agent-manager-key'), 'utf8').trim(); } catch { return ''; }
    })();

const POLL_INTERVAL = 3000; // 3 seconds
const fs = require('fs');
const USER_HOME = os.homedir();

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function fetchJSON(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
    mod.get(urlStr, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function patchJSON(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function resolveFolder(folderPath) {
  if (!folderPath) return USER_HOME;
  // If it's already an absolute path (e.g. resume sends full cwd), use it directly
  if (path.isAbsolute(folderPath)) return folderPath;
  // Otherwise treat as relative to user home (new-agent requests)
  return path.join(USER_HOME, folderPath);
}

function ensureWorkspaceTrusted(absolutePath) {
  // Pre-create the project directory in ~/.claude/projects/ AND write
  // a settings.local.json with trustWorkspace: true so Claude skips
  // the "trust this folder?" prompt on first launch.
  const normalized = absolutePath.replace(/\\/g, '/');
  const projectKey = normalized
    .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toLowerCase()}--`)
    .replace(/^([A-Z]):\//, (_, d) => `${d.toLowerCase()}--`)
    .replace(/\//g, '-');
  const projectDir = path.join(USER_HOME, '.claude', 'projects', projectKey);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
    log(`Pre-created project dir: ${projectDir}`);
  }
  // Write settings.local.json to mark workspace as trusted
  const settingsPath = path.join(projectDir, 'settings.local.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({ isTrusted: true }, null, 2));
    log(`Wrote trust settings: ${settingsPath}`);
  }
}

function launchNewAgent(folderPath) {
  const cwd = resolveFolder(folderPath);
  log(`Launching NEW agent in: ${cwd}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  // Launch interactive session directly (no pre-flight — it caused double agents)
  const proc = spawn('wt.exe', [
    'new-tab', '--title', `Claude - ${path.basename(cwd)}`,
    '-d', cwd,
    'cmd', '/k',
    'claude', '--dangerously-skip-permissions', 'run /session-init and then await instructions'
  ], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  log(`Spawned wt.exe for new agent`);
  return proc;
}

async function launchResumeAgent(agentId, folderPath) {
  let cwd = resolveFolder(folderPath);

  // If folder_path wasn't absolute, try fetching the agent's stored cwd from the server
  if (!path.isAbsolute(folderPath || '')) {
    try {
      const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
      if (agent && agent.cwd) {
        cwd = agent.cwd.replace(/\//g, '\\');
        log(`Using agent's stored cwd: ${cwd}`);
      }
    } catch (err) {
      log(`Could not fetch agent cwd from server: ${err.message}`);
    }
  }

  log(`Resuming agent ${agentId} in: ${cwd}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  // Launch resume session directly (no pre-flight — it caused double agents)
  const proc = spawn('wt.exe', [
    'new-tab', '--title', `Claude - ${path.basename(cwd)}`,
    '-d', cwd,
    'cmd', '/k',
    'claude', '--dangerously-skip-permissions', '--resume', agentId, 'run /session-resume and then await instructions'
  ], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  log(`Spawned wt.exe for resume agent ${agentId}`);
  return proc;
}

function terminateAgent(pid) {
  log(`Terminating terminal process with PID: ${pid}`);
  try {
    // The stored PID is the cmd.exe terminal tab (parent of claude.exe).
    // Killing it with /T /F closes the terminal window and all children (including claude).
    const proc = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'pipe',
    });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        log(`Successfully terminated PID ${pid} and its process tree`);
      } else {
        log(`taskkill exited with code ${code} for PID ${pid}: ${output.trim()}`);
      }
    });
  } catch (err) {
    log(`Failed to terminate PID ${pid}: ${err.message}`);
  }
}

async function processPendingRequests() {
  try {
    const requests = await fetchJSON(`${SERVER_URL}/api/launch-requests?status=pending`);
    if (!Array.isArray(requests) || requests.length === 0) return;

    for (const req of requests) {
      log(`Processing launch request #${req.id} (type: ${req.type})`);

      // Claim it
      await patchJSON(`${SERVER_URL}/api/launch-requests/${req.id}`, { status: 'claimed' });

      try {
        if (req.type === 'terminate') {
          if (req.target_pid) {
            terminateAgent(req.target_pid);
          } else {
            log(`Terminate request #${req.id} has no target_pid — skipping`);
          }
        } else if (req.type === 'resume' && req.resume_agent_id) {
          await launchResumeAgent(req.resume_agent_id, req.folder_path);
        } else if (req.type === 'new') {
          launchNewAgent(req.folder_path);
        } else {
          log(`Unknown request type "${req.type}" for #${req.id} — skipping`);
        }

        // Mark completed
        await patchJSON(`${SERVER_URL}/api/launch-requests/${req.id}`, { status: 'completed' });
        log(`Launch request #${req.id} completed`);
      } catch (err) {
        log(`Launch request #${req.id} failed: ${err.message}`);
        await patchJSON(`${SERVER_URL}/api/launch-requests/${req.id}`, { status: 'failed' });
      }
    }
  } catch (err) {
    // Silently retry on connection errors
    if (!err.message.includes('ECONNREFUSED')) {
      log(`Poll error: ${err.message}`);
    }
  }
}

// Main loop
log(`Agent Launcher started — polling ${SERVER_URL} every ${POLL_INTERVAL / 1000}s`);
log(`User home: ${USER_HOME}`);

setInterval(processPendingRequests, POLL_INTERVAL);
processPendingRequests(); // Run immediately on start
