#!/usr/bin/env node
/**
 * Host-side Agent Launcher
 *
 * Runs on the Windows or Linux host (NOT in Docker). Polls the Agent Manager
 * backend for pending launch requests and spawns Claude terminal sessions.
 *
 * Usage: node launcher.js [--server https://your-host.tailnet.ts.net]
 *        LAUNCHER_MODE=linux node launcher.js   (force Linux mode for testing)
 *
 * Platform detection: process.platform === 'linux' (auto) or LAUNCHER_MODE=linux env var
 *
 * Linux terminal strategy:
 *   - Named window groups (wtWindow) → tmux sessions (equivalent to Windows Terminal -w <name>)
 *   - Each agent tab → tmux window within the session
 *   - A gnome-terminal window attaches once per session for display
 *   - Dependencies: tmux, gnome-terminal  (sudo apt install tmux gnome-terminal)
 *   - Optional for signal/input sending: xdotool  (sudo apt install xdotool)
 *
 * Server URL resolution order:
 *   1. --server CLI argument
 *   2. SERVER_URL environment variable
 *   3. ~/.claude/agent-server-url file
 *   4. http://localhost:3001 (default)
 */

const { spawn, spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

// Platform detection — auto from process.platform, or override with LAUNCHER_MODE=linux
const IS_LINUX = process.platform === 'linux' || process.env.LAUNCHER_MODE === 'linux';

function discoverServerUrl() {
  if (process.argv.includes('--server')) {
    return process.argv[process.argv.indexOf('--server') + 1];
  }
  if (process.env.SERVER_URL) return process.env.SERVER_URL;
  try {
    const home = process.env.HOME || process.env.USERPROFILE;
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

async function postJSON(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
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
  if (!IS_LINUX) {
    // Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
    // Must happen before path.isAbsolute — Windows treats /c/... as absolute but wt.exe can't use it
    if (/^\/[a-zA-Z]\//.test(folderPath)) {
      folderPath = folderPath
        .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`)
        .replace(/\//g, '\\');
    }
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
  let projectKey;
  if (IS_LINUX) {
    // Linux: /home/user/Research/ClaudeManager → home-user-Research-ClaudeManager
    projectKey = normalized.replace(/^\//, '').replace(/\//g, '-');
  } else {
    projectKey = normalized
      .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toLowerCase()}--`)
      .replace(/^([A-Z]):\//, (_, d) => `${d.toLowerCase()}--`)
      .replace(/\//g, '-');
  }
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

// Linux: launch a terminal for the given script using tmux for named window groups.
// Named window groups (wtWindow) become tmux sessions; each agent tab is a tmux window.
// A gnome-terminal window is opened once per session (when first created).
// When the session already exists, the new window appears inside it automatically.
function linuxLaunchTerminal(cwd, scriptFile, tabTitle, wtWindow) {
  if (wtWindow) {
    const hasSession = spawnSync('tmux', ['has-session', '-t', wtWindow], { stdio: 'pipe' }).status === 0;
    if (!hasSession) {
      // Create new tmux session running the script, then open gnome-terminal attached to it
      spawn('tmux', ['new-session', '-d', '-s', wtWindow, '-n', tabTitle, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      spawn('gnome-terminal', ['--title', wtWindow, '--', 'tmux', 'attach', '-t', wtWindow],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Created tmux session "${wtWindow}", window "${tabTitle}"`);
    } else {
      // Session exists — add new window (the open gnome-terminal will display it)
      spawn('tmux', ['new-window', '-t', wtWindow, '-n', tabTitle, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Added tmux window "${tabTitle}" to existing session "${wtWindow}"`);
    }
  } else {
    // No window group — open directly in a standalone gnome-terminal
    spawn('gnome-terminal', ['--title', tabTitle, '--working-directory', cwd, '--', 'bash', scriptFile],
      { detached: true, stdio: 'ignore' }).unref();
    log(`Opened gnome-terminal for "${tabTitle}"`);
  }
}

function launchNewAgent(folderPath, spawnMeta, wtWindow) {
  const cwd = resolveFolder(folderPath);
  log(`Launching NEW agent in: ${cwd}${wtWindow ? ` [window: ${wtWindow}]` : ''}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  // No pre-created UUID: launch a plain new session. Claude creates its own
  // JSONL automatically; session-connect discovers it via `ls -t`. Pre-creating
  // an empty JSONL and using --resume broke because Claude requires a file with
  // actual content to resume — an empty file causes "No conversation found".
  const resumeFlag = '';

  // Checkin reminder appended to every initial prompt so agents report in from the very first task
  const CHECKIN_REMINDER = ' IMPORTANT: As you work, post session manager updates using /agent-checkin (or POST to your agent updates endpoint directly) — at the start of your first task, at roughly every 25% of progress, and on completion. The user monitors remotely and needs real-time visibility.';

  // All agents start with a clean session-init — task is delivered as a message
  // after registration so it doesn't compete with workspace context loading.
  let initialPrompt = `run /session-init and then await instructions.${CHECKIN_REMINDER}`;
  let tabTitle;
  if (spawnMeta && spawnMeta.role) {
    // Role may be a full multi-line definition — extract a short label for the tab title.
    // Split on first sentence boundary or em dash so "You are Cam — ..." → "You are Cam".
    const shortRole = spawnMeta.role.split(/\.\s|\s—\s|\r?\n/)[0].trim().substring(0, 60);
    tabTitle = `Claude - ${shortRole}`;
  } else {
    tabTitle = `Claude - ${path.basename(cwd)}`;
  }

  if (spawnMeta && (spawnMeta.role || spawnMeta.prompt)) {
    log(`Agent${spawnMeta.role ? ` role: ${spawnMeta.role}` : ''}, prompt: ${(spawnMeta.prompt || '').substring(0, 80)}...`);
  }

  const modelFlag = (spawnMeta && spawnMeta.model) ? ` --model ${spawnMeta.model}` : '';
  const effortFlag = (spawnMeta && spawnMeta.effort) ? ` --effort ${spawnMeta.effort}` : '';

  if (IS_LINUX) {
    // Linux: write a shell script and launch via tmux / gnome-terminal
    const scriptFile = path.join(os.tmpdir(), `claude-launch-${Date.now()}.sh`);
    // Escape single quotes in the prompt for safe embedding in a single-quoted bash string
    const promptEscaped = initialPrompt.replace(/'/g, "'\\''");
    fs.writeFileSync(scriptFile,
      `#!/bin/bash\ncd "${cwd}"\nexec claude --dangerously-skip-permissions${modelFlag}${effortFlag} '${promptEscaped}'\n`,
      { mode: 0o755 }
    );
    linuxLaunchTerminal(cwd, scriptFile, tabTitle, wtWindow);
    setTimeout(() => { try { fs.unlinkSync(scriptFile); } catch {} }, 30000);
    log(`Spawned terminal for new agent (Linux) via ${scriptFile}`);
    return;
  }

  // Windows: write prompt to a temp batch file to avoid cmd.exe special character issues
  const batchFile = path.join(os.tmpdir(), `claude-launch-${Date.now()}.bat`);
  // Escape the prompt for batch: double up % signs, wrap in quotes
  const batchPrompt = initialPrompt.replace(/%/g, '%%');
  fs.writeFileSync(batchFile, `@echo off\nclaude --dangerously-skip-permissions${modelFlag}${effortFlag}${resumeFlag} "${batchPrompt}"\n`, 'utf8');

  const wtArgs = wtWindow
    ? ['-w', wtWindow, 'new-tab', '--title', tabTitle, '-d', cwd, 'cmd', '/k', batchFile]
    : ['new-tab', '--title', tabTitle, '-d', cwd, 'cmd', '/k', batchFile];

  const proc = spawn('wt.exe', wtArgs, {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  // Clean up batch file after agent starts
  setTimeout(() => { try { fs.unlinkSync(batchFile); } catch {} }, 30000);
  log(`Spawned wt.exe for new agent via ${batchFile}`);
  return proc;
}

async function launchResumeAgent(agentId, folderPath, wtWindow) {
  let cwd = resolveFolder(folderPath);
  let resolvedWtWindow = wtWindow || null;

  // If folder_path wasn't absolute, try fetching the agent's stored cwd from the server
  if (!path.isAbsolute(folderPath || '')) {
    try {
      const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
      if (agent && agent.cwd) {
        if (IS_LINUX) {
          cwd = agent.cwd; // Already a POSIX absolute path on Linux
        } else {
          // Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
          cwd = agent.cwd
            .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`)
            .replace(/\//g, '\\');
        }
        log(`Using agent's stored cwd: ${cwd}`);
      }
      // Also pick up the stored wt_window if not passed explicitly
      if (!resolvedWtWindow && agent && agent.wt_window) {
        resolvedWtWindow = agent.wt_window;
      }
    } catch (err) {
      log(`Could not fetch agent cwd from server: ${err.message}`);
    }
  }

  log(`Resuming agent ${agentId} in: ${cwd}${resolvedWtWindow ? ` [window: ${resolvedWtWindow}]` : ''}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  const tabTitle = `Claude - ${path.basename(cwd)}`;

  if (IS_LINUX) {
    // Linux: write a shell script and launch via tmux / gnome-terminal
    const scriptFile = path.join(os.tmpdir(), `claude-resume-${Date.now()}.sh`);
    fs.writeFileSync(scriptFile,
      `#!/bin/bash\ncd "${cwd}"\nexec claude --dangerously-skip-permissions --resume ${agentId} 'run /session-resume and then await instructions'\n`,
      { mode: 0o755 }
    );
    linuxLaunchTerminal(cwd, scriptFile, tabTitle, resolvedWtWindow);
    setTimeout(() => { try { fs.unlinkSync(scriptFile); } catch {} }, 30000);
    log(`Spawned terminal for resume agent ${agentId} (Linux) via ${scriptFile}`);
    return;
  }

  // Windows: write resume command to a temp batch file (avoids wt.exe arg parsing issues)
  const batchFile = path.join(os.tmpdir(), `claude-resume-${Date.now()}.bat`);
  fs.writeFileSync(batchFile, `@echo off\nclaude --dangerously-skip-permissions --resume ${agentId} "run /session-resume and then await instructions"\n`, 'utf8');

  const wtArgs = resolvedWtWindow
    ? ['-w', resolvedWtWindow, 'new-tab', '--title', tabTitle, '-d', cwd, 'cmd', '/k', batchFile]
    : ['new-tab', '--title', tabTitle, '-d', cwd, 'cmd', '/k', batchFile];

  const proc = spawn('wt.exe', wtArgs, {
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

  if (IS_LINUX) {
    if (signal === 'ctrl-c') {
      // On Linux, Claude runs directly — send SIGINT straight to the process
      try {
        process.kill(pid, 'SIGINT');
        log(`Sent SIGINT to PID ${pid}`);
      } catch (err) {
        log(`Failed to send SIGINT to PID ${pid}: ${err.message}`);
      }
    } else {
      // Enter key via xdotool — requires: sudo apt install xdotool
      const proc = spawn('sh', ['-c',
        `WID=$(xdotool search --pid ${pid} 2>/dev/null | head -1); ` +
        `[ -z "$WID" ] && WID=$(xdotool getactivewindow 2>/dev/null); ` +
        `[ -n "$WID" ] && xdotool key --window "$WID" Return && echo "Sent Enter" || echo "ACTIVATE_FAILED"`
      ], { stdio: 'pipe' });
      proc.stdout.on('data', (data) => log(`[signal] ${data.toString().trim()}`));
      proc.stderr.on('data', (data) => log(`[signal] ERR: ${data.toString().trim()}`));
    }
    return;
  }

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

  if (IS_LINUX) {
    // Use xdotool to type into the terminal window — requires: sudo apt install xdotool
    const escaped = text.replace(/'/g, "'\\''");
    const proc = spawn('sh', ['-c',
      `WID=$(xdotool search --pid ${pid} 2>/dev/null | head -1); ` +
      `[ -z "$WID" ] && WID=$(xdotool getactivewindow 2>/dev/null); ` +
      `[ -n "$WID" ] && xdotool type --window "$WID" --clearmodifiers '${escaped}' && xdotool key --window "$WID" Return && echo "Typed text" || echo "ACTIVATE_FAILED"`
    ], { stdio: 'pipe' });
    proc.stdout.on('data', (data) => log(`[input] ${data.toString().trim()}`));
    proc.stderr.on('data', (data) => log(`[input] ERR: ${data.toString().trim()}`));
    return;
  }

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

  if (IS_LINUX) {
    try {
      // SIGTERM first; follow up with SIGKILL after 3s if the process is still alive
      process.kill(pid, 'SIGTERM');
      log(`Sent SIGTERM to PID ${pid}`);
      setTimeout(() => {
        try {
          process.kill(pid, 0); // signal 0 = existence check, throws if gone
          process.kill(pid, 'SIGKILL');
          log(`Sent SIGKILL to PID ${pid} (still alive after SIGTERM)`);
        } catch {
          // Process already gone — expected
        }
      }, 3000);
    } catch (err) {
      log(`Failed to terminate PID ${pid}: ${err.message}`);
    }
    return;
  }

  try {
    // Windows: The stored PID is the cmd.exe terminal tab (parent of claude.exe).
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

// Track the last time each wt window name was used in the current process run,
// so that multiple same-window launches are staggered and the first window has
// time to register before the second wt.exe / tmux fires.
const wtWindowLastLaunch = new Map();
const WT_WINDOW_STAGGER_MS = 1500;

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
          const wtWin = req.wt_window || null;
          // Guard: skip only if the agent has a confirmed-alive PID. Recency is not
          // used — it incorrectly blocks agents that were just manually closed.
          const LIVE_STATUSES = ['active', 'working', 'idle', 'waiting-for-input', 'standby'];
          let agentPid = null;
          let agentStatus = null;
          try {
            const agent = await fetchJSON(`${SERVER_URL}/api/agents/${req.resume_agent_id}`);
            agentPid = agent && agent.pid;
            agentStatus = agent && agent.status;
          } catch {}
          const agentIsLive = LIVE_STATUSES.includes(agentStatus);
          // No stored PID means we can't confirm liveness → allow resume
          const pidIsAlive = agentPid ? isPidRunning(agentPid) : false;
          if (agentIsLive && pidIsAlive) {
            log(`Agent ${req.resume_agent_id} is live with running PID ${agentPid} — skipping resume`);
          } else {
            if (agentIsLive) {
              log(`Agent ${req.resume_agent_id} status=${agentStatus} but PID ${agentPid || 'none'} is not running — allowing resume`);
            }
            if (wtWin) {
              const last = wtWindowLastLaunch.get(wtWin) || 0;
              const elapsed = Date.now() - last;
              if (elapsed < WT_WINDOW_STAGGER_MS) {
                const wait = WT_WINDOW_STAGGER_MS - elapsed;
                log(`Staggering ${wait}ms for window "${wtWin}" so first tab registers`);
                await new Promise(r => setTimeout(r, wait));
              }
              wtWindowLastLaunch.set(wtWin, Date.now());
            }
            await launchResumeAgent(req.resume_agent_id, req.folder_path, wtWin);
          }
        } else if (req.type === 'terminate-resume' && req.resume_agent_id) {
          // Kill existing terminal tab if alive, then resume in a fresh tab.
          // Look up live PID from DB if not in the request (agent may have updated it since request was made).
          let terminatePid = req.target_pid || null;
          try {
            const agent = await fetchJSON(`${SERVER_URL}/api/agents/${req.resume_agent_id}`);
            if (agent && agent.pid) terminatePid = agent.pid;
          } catch {}
          if (terminatePid && isPidRunning(terminatePid)) {
            log(`Terminating PID ${terminatePid} before resume of agent ${req.resume_agent_id}`);
            terminateAgent(terminatePid);
            await new Promise(r => setTimeout(r, 1500));
          } else {
            log(`No live PID to terminate for agent ${req.resume_agent_id} — resuming directly`);
          }
          const wtWin = req.wt_window || null;
          if (wtWin) {
            const last = wtWindowLastLaunch.get(wtWin) || 0;
            const elapsed = Date.now() - last;
            if (elapsed < WT_WINDOW_STAGGER_MS) {
              const wait = WT_WINDOW_STAGGER_MS - elapsed;
              log(`Staggering ${wait}ms for window "${wtWin}" so first tab registers`);
              await new Promise(r => setTimeout(r, wait));
            }
            wtWindowLastLaunch.set(wtWin, Date.now());
          }
          await launchResumeAgent(req.resume_agent_id, req.folder_path, wtWin);
        } else if (req.type === 'new') {
          let spawnMeta = null;
          if (req.agent_id && typeof req.agent_id === 'string' && req.agent_id.startsWith('{')) {
            try { spawnMeta = JSON.parse(req.agent_id); } catch {}
          }
          const wtWindow = req.wt_window || (spawnMeta && spawnMeta.wt_window) || null;
          if (wtWindow) {
            const last = wtWindowLastLaunch.get(wtWindow) || 0;
            const elapsed = Date.now() - last;
            if (elapsed < WT_WINDOW_STAGGER_MS) {
              const wait = WT_WINDOW_STAGGER_MS - elapsed;
              log(`Staggering ${wait}ms for window "${wtWindow}" so first tab registers`);
              await new Promise(r => setTimeout(r, wait));
            }
            wtWindowLastLaunch.set(wtWindow, Date.now());
          }
          launchNewAgent(req.folder_path, spawnMeta, wtWindow);
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

/**
 * Pool recovery — runs every 30s as a safety net.
 * Finds standby pool agents whose OS process has died (stale PID) and
 * creates resume launch requests so they restart automatically.
 * The PM also does its own pool recovery on startup; this catches mid-session deaths.
 */
const POOL_CHECK_INTERVAL = 30000;
let poolCheckCounter = 0;

function isPidRunning(pid) {
  if (!pid) return false;
  if (IS_LINUX) {
    // On Linux, kill -0 reliably checks process existence without sending a signal
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    // Windows: Use PowerShell for a reliable process check.
    // process.kill(pid, 0) is unreliable on Windows (cmd.exe children of wt.exe).
    const { execSync } = require('child_process');
    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null"`,
      { windowsHide: true, timeout: 3000 }
    ).toString().trim();
    return result === 'True';
  } catch {
    return false;
  }
}

async function processPoolAgents() {
  try {
    const agents = await fetchJSON(`${SERVER_URL}/api/agents?pool_only=true`);
    if (!Array.isArray(agents) || agents.length === 0) return;

    for (const agent of agents) {
      if (agent.status === 'archived') continue;
      if (isPidRunning(agent.pid)) continue;

      // Dead pool agent — create a resume request
      log(`Pool agent ${agent.id} (slot ${agent.pool_slot}) PID ${agent.pid} is dead — queuing resume`);
      await postJSON(`${SERVER_URL}/api/launch-requests`, {
        type: 'resume',
        resume_agent_id: agent.id,
        folder_path: agent.workspace || agent.cwd || '',
      });
    }
  } catch (err) {
    if (!err.message?.includes('ECONNREFUSED')) {
      log(`Pool check error: ${err.message}`);
    }
  }
}

// Main loop — use recursive setTimeout so concurrent invocations can't overlap.
// setInterval does not await async callbacks, meaning if a poll takes >3s (e.g.
// HTTPS Tailscale latency), the next tick fires before the first finishes and
// both invocations see the same 'pending' request → double spawn.
log(`Agent Launcher started — polling ${SERVER_URL} every ${POLL_INTERVAL / 1000}s`);
log(`User home: ${USER_HOME}`);
log(`Platform: ${IS_LINUX ? 'Linux' : 'Windows'}`);

async function schedulePoll() {
  await processPendingRequests();

  // Run pool check every ~30s (every 10th poll at 3s interval)
  poolCheckCounter++;
  if (poolCheckCounter >= 10) {
    poolCheckCounter = 0;
    await processPoolAgents();
  }

  setTimeout(schedulePoll, POLL_INTERVAL);
}

schedulePoll();
