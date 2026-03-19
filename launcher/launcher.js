#!/usr/bin/env node
/**
 * Host-side Agent Launcher
 *
 * Runs on the Windows host (NOT in Docker). Polls the Agent Manager backend
 * for pending launch requests and spawns Claude terminal sessions.
 *
 * Usage: node launcher.js [--server http://localhost:8080]
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

const SERVER_URL = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : 'http://localhost:8080';

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
    mod.get(urlStr, { headers: { 'Content-Type': 'application/json' } }, (res) => {
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
  // The folder_path from the API is relative to user home
  if (!folderPath) return USER_HOME;
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

  // Pre-create project dir so Claude skips the trust prompt
  ensureWorkspaceTrusted(cwd);

  // Step 1: Run claude -p headlessly to establish trust (skips trust dialog in -p mode)
  // Step 2: Launch interactive session (trust is now established)
  return new Promise((resolve) => {
    log(`Pre-trusting workspace via claude -p...`);
    const trust = spawn('claude', ['-p', 'ok'], {
      cwd,
      stdio: 'ignore',
      shell: true,
    });
    trust.on('close', () => {
      log(`Trust established, launching interactive session`);
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
      resolve(proc);
    });
    // Timeout after 30s in case -p hangs
    setTimeout(() => {
      try { trust.kill(); } catch {}
      log(`Trust pre-flight timed out, launching anyway`);
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
      resolve(proc);
    }, 30000);
  });
}

function launchResumeAgent(agentId, folderPath) {
  const cwd = resolveFolder(folderPath);
  log(`Resuming agent ${agentId} in: ${cwd}`);

  // Pre-create project dir
  ensureWorkspaceTrusted(cwd);

  return new Promise((resolve) => {
    log(`Pre-trusting workspace via claude -p...`);
    const trust = spawn('claude', ['-p', 'ok'], {
      cwd,
      stdio: 'ignore',
      shell: true,
    });
    trust.on('close', () => {
      log(`Trust established, launching resume session`);
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
      resolve(proc);
    });
    setTimeout(() => {
      try { trust.kill(); } catch {}
      log(`Trust pre-flight timed out, launching anyway`);
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
      resolve(proc);
    }, 30000);
  });
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
        if (req.type === 'resume' && req.resume_agent_id) {
          launchResumeAgent(req.resume_agent_id, req.folder_path);
        } else {
          launchNewAgent(req.folder_path);
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
