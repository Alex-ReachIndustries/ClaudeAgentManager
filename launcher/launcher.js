#!/usr/bin/env node
/**
 * Host-side Agent Launcher
 *
 * Runs on the Windows host (NOT in Docker). Polls the Agent Manager backend
 * for pending launch requests and spawns Claude terminal sessions.
 *
 * Usage: node launcher.js [--server https://your-host.tailnet.ts.net]
 *
 * Server URL resolution order:
 *   1. --server CLI argument
 *   2. SERVER_URL environment variable
 *   3. http://localhost:8080 (default)
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

function discoverServerUrl() {
  if (process.argv.includes('--server')) {
    return process.argv[process.argv.indexOf('--server') + 1];
  }
  if (process.env.SERVER_URL) return process.env.SERVER_URL;
  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    const urlFile = require('path').join(home, '.claude', 'agent-server-url');
    return require('fs').readFileSync(urlFile, 'utf8').trim();
  } catch {
    return 'http://localhost:3001';
  }
}
const SERVER_URL = discoverServerUrl();

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
  // Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
  // Must happen before path.isAbsolute — Windows treats /c/... as absolute but wt.exe can't use it
  if (/^\/[a-zA-Z]\//.test(folderPath)) {
    folderPath = folderPath
      .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`)
      .replace(/\//g, '\\');
  }
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

// Track sidecar processes for cleanup
// MQTT sidecar removed — agents poll HTTP directly via background watcher

function launchNewAgent(folderPath, spawnMeta) {
  const cwd = resolveFolder(folderPath);
  log(`Launching NEW agent in: ${cwd}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  // Checkin reminder appended to every initial prompt so agents report in from the very first task
  const CHECKIN_REMINDER = ' IMPORTANT: As you work, post session manager updates using /agent-checkin (or POST to your agent updates endpoint directly) — at the start of your first task, at roughly every 25% of progress, and on completion. The user monitors remotely and needs real-time visibility.';

  // All agents start with a clean session-init — task is delivered as a message
  // after registration so it doesn't compete with workspace context loading.
  let initialPrompt = `run /session-init and then await instructions.${CHECKIN_REMINDER}`;
  let tabTitle;
  if (spawnMeta && spawnMeta.role) {
    // Role may be a full multi-line definition — extract a short label for the tab title.
    // Split on first sentence boundary or em dash so "You are Cam — ..." → "You are Cam".
    const shortRole = spawnMeta.role.split(/\.\s|\s\u2014\s|\r?\n/)[0].trim().substring(0, 60);
    tabTitle = `Claude - ${shortRole}`;
  } else {
    tabTitle = `Claude - ${path.basename(cwd)}`;
  }

  if (spawnMeta && (spawnMeta.role || spawnMeta.prompt)) {
    log(`Agent${spawnMeta.role ? ` role: ${spawnMeta.role}` : ''}, prompt: ${(spawnMeta.prompt || '').substring(0, 80)}...`);
  }

  // Write prompt to a temp batch file to avoid cmd.exe special character issues
  // The batch file launches claude with the prompt properly quoted
  const batchFile = path.join(os.tmpdir(), `claude-launch-${Date.now()}.bat`);
  // Escape the prompt for batch: double up % signs, wrap in quotes
  const batchPrompt = initialPrompt.replace(/%/g, '%%');
  const modelFlag = (spawnMeta && spawnMeta.model) ? ` --model ${spawnMeta.model}` : '';
  const effortFlag = (spawnMeta && spawnMeta.effort) ? ` --effort ${spawnMeta.effort}` : '';
  fs.writeFileSync(batchFile, `@echo off\nclaude --dangerously-skip-permissions${modelFlag}${effortFlag} "${batchPrompt}"\n`, 'utf8');

  const proc = spawn('wt.exe', [
    'new-tab', '--title', tabTitle,
    '-d', cwd,
    'cmd', '/k', batchFile
  ], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  // Clean up batch file after agent starts
  setTimeout(() => { try { fs.unlinkSync(batchFile); } catch {} }, 30000);
  log(`Spawned wt.exe for new agent via ${batchFile}`);
  return proc;
}

async function launchResumeAgent(agentId, folderPath) {
  let cwd = resolveFolder(folderPath);

  // If folder_path wasn't absolute, try fetching the agent's stored cwd from the server
  if (!path.isAbsolute(folderPath || '')) {
    try {
      const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
      if (agent && agent.cwd) {
        // Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
        cwd = agent.cwd
          .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`)
          .replace(/\//g, '\\');
        log(`Using agent's stored cwd: ${cwd}`);
      }
    } catch (err) {
      log(`Could not fetch agent cwd from server: ${err.message}`);
    }
  }

  log(`Resuming agent ${agentId} in: ${cwd}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  // Write resume command to a temp batch file (same approach as new agent — avoids wt.exe arg parsing issues)
  const batchFile = path.join(os.tmpdir(), `claude-resume-${Date.now()}.bat`);
  fs.writeFileSync(batchFile, `@echo off\nclaude --dangerously-skip-permissions --resume ${agentId} "run /session-resume and then await instructions"\n`, 'utf8');

  const proc = spawn('wt.exe', [
    'new-tab', '--title', `Claude - ${path.basename(cwd)}`,
    '-d', cwd,
    'cmd', '/k', batchFile
  ], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  setTimeout(() => { try { fs.unlinkSync(batchFile); } catch {} }, 30000);
  log(`Spawned wt.exe for resume agent ${agentId} via ${batchFile}`);
  return proc;
}

function sendSignalToTerminal(pid, signal, agentId) {
  // Try: PID -> parent PID -> find claude.exe by agent UUID in command line
  log(`Sending ${signal} to terminal PID ${pid}${agentId ? ` (agent ${agentId.substring(0,8)})` : ''}`);
  try {
    // Build the activation script: try PID, parent PID, then search by agent UUID
    const agentSearch = agentId
      ? `if (-not $sent) { ` +
        `  $cp = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -match '${agentId.substring(0,8)}' } | Select-Object -First 1; ` +
        `  if ($cp) { ` +
        `    $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($cp.ProcessId)").ParentProcessId; ` +
        `    if ($pp) { $sent = $wshell.AppActivate($pp) }; ` +
        `    if (-not $sent) { $sent = $wshell.AppActivate($cp.ProcessId) }; ` +
        `  } ` +
        `}; `
      : '';

    const activateScript =
      `$sent = $false; ` +
      `$wshell = New-Object -ComObject wscript.shell; ` +
      // Try stored PID and its parent
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { ` +
      `  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId; ` +
      `  if ($pp) { $sent = $wshell.AppActivate($pp) }; ` +
      `  if (-not $sent) { $sent = $wshell.AppActivate(${pid}) }; ` +
      `}; ` +
      agentSearch +
      // Final fallback: activate WindowsTerminal process (sends to active tab)
      `if (-not $sent) { ` +
      `  $wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `  if ($wt) { $sent = $wshell.AppActivate($wt.Id) } ` +
      `}; `;

    const keys = signal === 'ctrl-c' ? "'^c'" : "'{ENTER}'";
    const label = signal === 'ctrl-c' ? 'Ctrl+C' : 'Enter';

    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      activateScript +
      `if ($sent) { ` +
      `  Add-Type -AssemblyName System.Windows.Forms; ` +
      `  Start-Sleep -Milliseconds 300; ` +
      `  [System.Windows.Forms.SendKeys]::SendWait(${keys}); ` +
      `  Write-Host "Sent ${label}" ` +
      `} else { Write-Host "ACTIVATE_FAILED" }`
    ], { stdio: 'pipe', windowsHide: true });
    proc.stdout.on('data', (data) => log(`[signal] ${data.toString().trim()}`));
    proc.stderr.on('data', (data) => log(`[signal] ERR: ${data.toString().trim()}`));
    proc.on('close', (code) => log(`[signal] ${label} done (exit ${code})`));
  } catch (err) {
    log(`Failed to send signal: ${err.message}`);
  }
}

function sendTextToTerminal(pid, text, agentId) {
  log(`Typing "${text}" into terminal PID ${pid}${agentId ? ` (agent ${agentId.substring(0,8)})` : ''}`);
  try {
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}');
    const agentSearch = agentId
      ? `if (-not $sent) { ` +
        `  $cp = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -match '${agentId.substring(0,8)}' } | Select-Object -First 1; ` +
        `  if ($cp) { ` +
        `    $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($cp.ProcessId)").ParentProcessId; ` +
        `    if ($pp) { $sent = $wshell.AppActivate($pp) }; ` +
        `    if (-not $sent) { $sent = $wshell.AppActivate($cp.ProcessId) }; ` +
        `  } ` +
        `}; `
      : '';

    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `$sent = $false; ` +
      `$wshell = New-Object -ComObject wscript.shell; ` +
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { ` +
      `  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId; ` +
      `  if ($pp) { $sent = $wshell.AppActivate($pp) }; ` +
      `  if (-not $sent) { $sent = $wshell.AppActivate(${pid}) }; ` +
      `}; ` +
      agentSearch +
      `if (-not $sent) { ` +
      `  $wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `  if ($wt) { $sent = $wshell.AppActivate($wt.Id) } ` +
      `}; ` +
      `if ($sent) { ` +
      `  Add-Type -AssemblyName System.Windows.Forms; ` +
      `  Start-Sleep -Milliseconds 500; ` +
      `  [System.Windows.Forms.SendKeys]::SendWait("${escaped}"); ` +
      `  Start-Sleep -Milliseconds 200; ` +
      `  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); ` +
      `  Write-Host "Typed text and Enter" ` +
      `} else { Write-Host "ACTIVATE_FAILED" }`
    ], { stdio: 'pipe', windowsHide: true });
    proc.stdout.on('data', (data) => log(`[input] ${data.toString().trim()}`));
    proc.stderr.on('data', (data) => log(`[input] ERR: ${data.toString().trim()}`));
    proc.on('close', (code) => log(`[input] Text sent (exit ${code})`));
  } catch (err) {
    log(`Failed to send text: ${err.message}`);
  }
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
          let spawnMeta = null;
          if (req.agent_id && typeof req.agent_id === 'string' && req.agent_id.startsWith('{')) {
            try { spawnMeta = JSON.parse(req.agent_id); } catch {}
          }
          launchNewAgent(req.folder_path, spawnMeta);
        } else if (req.type === 'signal') {
          sendSignalToTerminal(req.target_pid, req.folder_path, req.resume_agent_id);
        } else if (req.type === 'input') {
          sendTextToTerminal(req.target_pid, req.folder_path, req.resume_agent_id);
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
