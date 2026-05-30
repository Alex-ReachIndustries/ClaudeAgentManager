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

// Model resolver — maps family aliases and legacy versions to the current latest.
// To upgrade: update the values here. DB records storing old versions auto-upgrade on next spawn.
const MODEL_DEFAULTS = {
  // Short family aliases (preferred for new agents stored in DB)
  'opus':    'claude-opus-4-8',
  'sonnet':  'claude-sonnet-4-6',
  'haiku':   'claude-haiku-4-5-20251001',
  // claude- prefixed family aliases
  'claude-opus':   'claude-opus-4-8',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku':  'claude-haiku-4-5-20251001',
  // Legacy pinned versions — auto-upgrade to latest
  'claude-opus-4-5':  'claude-opus-4-8',
  'claude-opus-4-6':  'claude-opus-4-8',
  'claude-opus-4-7':  'claude-opus-4-8',
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
};

function resolveModel(model) {
  if (!model) return undefined;
  return MODEL_DEFAULTS[model] || model;
}

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

// Linux: check whether a tmux window named by the agent's short UUID exists in a session.
// This is the primary liveness check on Linux — more reliable than PIDs because:
//   - PIDs can be recycled and the tmux server PID was previously misused as the agent PID
//   - tmux state is ground truth for whether a process window is actually alive
function isTmuxWindowAlive(agentId, sessionName) {
  if (!agentId) return false;
  const session = sessionName || 'ungrouped';
  const shortId = agentId.substring(0, 8);
  const result = spawnSync('tmux', ['list-windows', '-t', session, '-F', '#{window_name}'],
    { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) return false;
  return result.stdout.split('\n').some(name => name.trim() === shortId);
}

// Linux: kill a specific agent's tmux window by its short UUID.
// Returns true if the window was killed successfully.
function killTmuxWindow(agentId, sessionName) {
  if (!agentId) return false;
  const session = sessionName || 'ungrouped';
  const shortId = agentId.substring(0, 8);
  const result = spawnSync('tmux', ['kill-window', '-t', `${session}:${shortId}`],
    { encoding: 'utf8', stdio: 'pipe' });
  if (result.status === 0) {
    log(`Killed tmux window ${session}:${shortId} for agent ${agentId}`);
    return true;
  }
  log(`Could not kill tmux window ${session}:${shortId}: ${(result.stderr || '').trim()}`);
  return false;
}

// Linux: launch a terminal for the given script using tmux for named window groups.
// Named window groups (wtWindow) become tmux sessions; each agent tab is a tmux window.
// When agentId is provided, the window is named by the first 8 chars of the UUID so that
// isTmuxWindowAlive() and killTmuxWindow() can target it precisely without relying on PIDs.
function linuxLaunchTerminal(cwd, scriptFile, tabTitle, wtWindow, agentId) {
  const windowName = agentId ? agentId.substring(0, 8) : tabTitle.substring(0, 40);
  if (wtWindow) {
    const hasSession = spawnSync('tmux', ['has-session', '-t', wtWindow], { stdio: 'pipe' }).status === 0;
    if (!hasSession) {
      // Create new tmux session running the script, then open gnome-terminal attached to it
      spawn('tmux', ['new-session', '-d', '-s', wtWindow, '-n', windowName, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      spawn('gnome-terminal', ['--title', wtWindow, '--', 'tmux', 'attach', '-t', wtWindow],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Created tmux session "${wtWindow}", window "${windowName}"`);
    } else {
      // Session exists — add new window (the open gnome-terminal will display it)
      spawn('tmux', ['new-window', '-t', wtWindow, '-n', windowName, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Added tmux window "${windowName}" to existing session "${wtWindow}"`);
    }
  } else {
    // No window group — fall back to a dedicated "ungrouped" tmux session rather than a
    // standalone gnome-terminal. Standalone terminals can be hidden, block on interactive
    // prompts, and aren't manageable via tmux. "ungrouped" keeps Dailies uncluttered.
    const fallbackSession = 'ungrouped';
    const hasFallback = spawnSync('tmux', ['has-session', '-t', fallbackSession], { stdio: 'pipe' }).status === 0;
    if (!hasFallback) {
      spawn('tmux', ['new-session', '-d', '-s', fallbackSession, '-n', windowName, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      spawn('gnome-terminal', ['--title', fallbackSession, '--', 'tmux', 'attach', '-t', fallbackSession],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Created fallback tmux session "${fallbackSession}", window "${windowName}"`);
    } else {
      spawn('tmux', ['new-window', '-t', fallbackSession, '-n', windowName, scriptFile],
        { detached: true, stdio: 'ignore' }).unref();
      log(`Added window "${windowName}" to fallback tmux session "${fallbackSession}"`);
    }
  }
}

// After a Linux tmux window is spawned, poll its pane content for the Claude
// "trust this folder" prompt and send Enter to accept it automatically.
// windowName is the tmux window name (agent short UUID or tabTitle for new agents).
// Polls every 2s for up to 30s after an initial 6s startup delay.
async function autoAcceptTrustDialog(session, windowName) {
  await new Promise(r => setTimeout(r, 6000));
  const deadline = Date.now() + 30000;
  const nameSearch = windowName.substring(0, 40);
  while (Date.now() < deadline) {
    try {
      const listResult = spawnSync('tmux',
        ['list-windows', '-t', session, '-F', '#{window_index} #{window_name}'],
        { encoding: 'utf8', stdio: 'pipe' });
      const windowLine = (listResult.stdout || '').split('\n')
        .find(l => l.slice(l.indexOf(' ') + 1).trim() === nameSearch ||
                   l.slice(l.indexOf(' ') + 1).startsWith(nameSearch.slice(0, 30)));
      if (windowLine) {
        const windowIndex = windowLine.split(' ')[0];
        const target = `${session}:${windowIndex}`;
        const captureResult = spawnSync('tmux',
          ['capture-pane', '-p', '-t', target],
          { encoding: 'utf8', stdio: 'pipe' });
        const pane = captureResult.stdout || '';
        if (/trust/i.test(pane)) {
          log(`Trust dialog detected in ${target} — sending Enter to accept`);
          spawnSync('tmux', ['send-keys', '-t', target, '', 'Enter'], { stdio: 'pipe' });
          log(`Trust dialog accepted in ${target}`);
          return;
        }
      }
    } catch (err) {
      log(`Trust dialog poll error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  // Timeout is normal — workspace was likely already trusted
}

// After a new agent is spawned, poll until it registers (matching cwd), then
// deliver the task prompt as a message. Timeout after 2 minutes.
//
// Two safeguards against mis-delivery:
// 1. spawnTime: only match agents whose created_at is >= spawnTime (minus 3s
//    clock-skew grace). This prevents matching an already-running agent that
//    happens to share the same cwd and was created within the old 5-min window.
// 2. promptDeliveredAgentIds: a module-level Set that marks agents that already
//    received a prompt. Concurrent watchers for the same cwd (e.g. two pool
//    slots spawned in rapid succession) will skip a claimed agent and wait for
//    the next one to register.
async function deliverPromptWhenRegistered(cwd, prompt) {
  const spawnTime = Date.now();
  const deadline = spawnTime + 120000;
  const normCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  log(`Waiting for agent at "${normCwd}" to register before delivering prompt...`);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const agents = await fetchJSON(`${SERVER_URL}/api/agents`);
      const list = Array.isArray(agents) ? agents : (agents.data || agents.agents || []);
      const fresh = list.find(a => {
        if (a.status === 'archived') return false;
        if (promptDeliveredAgentIds.has(a.id)) return false;
        const agentCwd = (a.cwd || '').replace(/\\/g, '/').replace(/\/$/, '');
        const registeredAt = new Date(a.created_at).getTime();
        // Only match agents that registered after this spawn started (3s grace for clock skew)
        return agentCwd === normCwd && registeredAt >= spawnTime - 3000;
      });
      if (fresh) {
        promptDeliveredAgentIds.add(fresh.id);
        log(`Delivering prompt to agent ${fresh.id} at "${normCwd}"`);
        await postJSON(`${SERVER_URL}/api/agents/${fresh.id}/messages`, {
          content: prompt,
          source: 'user',
        });
        log(`Prompt delivered to ${fresh.id}`);
        return;
      }
    } catch (err) {
      log(`Prompt delivery poll error: ${err.message}`);
    }
  }
  log(`Timed out (2 min) waiting for agent at "${normCwd}" to register — prompt not delivered`);
}

function launchNewAgent(folderPath, spawnMeta, wtWindow, pregenUuid) {
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

  // If a task prompt was provided, deliver it as a message once the agent registers.
  // Agents start with /session-init so the task arrives after workspace context loads.
  if (spawnMeta && spawnMeta.prompt) {
    deliverPromptWhenRegistered(cwd, spawnMeta.prompt);
  }

  const modelFlag = (spawnMeta && spawnMeta.model) ? ` --model ${resolveModel(spawnMeta.model)}` : '';
  const effortFlag = (spawnMeta && spawnMeta.effort) ? ` --effort ${spawnMeta.effort}` : '';

  if (IS_LINUX) {
    // Linux: pre-generate a UUID so we can name the tmux window BEFORE the agent
    // starts, and pass CLAUDE_AGENT_ID so session-connect doesn't need to guess.
    // We pre-create an empty .jsonl file and use --resume <uuid> to force Claude
    // to adopt the UUID we chose — the agent starts fresh (empty history) but with
    // a known identity from the very first line of its launch script.
    const newUuid = pregenUuid || randomUUID();
    const shortId = newUuid.substring(0, 8);
    const session = wtWindow || 'ungrouped';
    const projectKey = cwd.replace(/\//g, '-'); // /home/user/proj → -home-user-proj
    const jsonlDir = path.join(USER_HOME, '.claude', 'projects', projectKey);
    const jsonlPath = path.join(jsonlDir, `${newUuid}.jsonl`);
    try {
      fs.mkdirSync(jsonlDir, { recursive: true });
      // Write a minimal valid conversation so claude --resume can find the session.
      // Permission-mode alone returns "No conversation found" — a user message is required.
      const permLine = JSON.stringify({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: newUuid });
      const msgLine = JSON.stringify({
        parentUuid: null, isSidechain: false, promptId: randomUUID(),
        type: 'user',
        message: { role: 'user', content: 'run /session-connect' },
        uuid: randomUUID(), timestamp: new Date().toISOString(),
        permissionMode: 'bypassPermissions', userType: 'external', entrypoint: 'cli',
        cwd, sessionId: newUuid, version: '2.1.126', gitBranch: 'main',
      });
      fs.writeFileSync(jsonlPath, permLine + '\n' + msgLine + '\n');
    } catch (err) {
      log(`Warning: could not pre-create .jsonl for ${newUuid}: ${err.message}`);
    }

    const scriptFile = path.join(os.tmpdir(), `claude-launch-${Date.now()}.sh`);
    const promptEscaped = initialPrompt.replace(/'/g, "'\\''");
    fs.writeFileSync(scriptFile,
      `#!/bin/bash\nexport CLAUDE_AGENT_ID="${newUuid}"\nexport CLAUDE_TMUX_SESSION="${session}"\nexport CLAUDE_TMUX_WINDOW="${shortId}"\ncd "${cwd}"\nexec claude --dangerously-skip-permissions${modelFlag}${effortFlag} --resume ${newUuid} '${promptEscaped}'\n`,
      { mode: 0o755 }
    );
    linuxLaunchTerminal(cwd, scriptFile, tabTitle, wtWindow, newUuid);
    autoAcceptTrustDialog(session, shortId);
    scheduleArrangement(session);
    setTimeout(() => { try { fs.unlinkSync(scriptFile); } catch {} }, 30000);
    log(`Spawned new agent ${newUuid} (Linux) — tmux window "${session}:${shortId}"`);
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
  let agentModelFlag = '';
  let agentEffortFlag = '';

  // Always fetch agent to get stored cwd, wt_window, model, and effort
  try {
    const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
    if (agent) {
      if (!path.isAbsolute(folderPath || '') && agent.cwd) {
        if (IS_LINUX) {
          cwd = agent.cwd;
        } else {
          // Convert Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
          cwd = agent.cwd
            .replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`)
            .replace(/\//g, '\\');
        }
        log(`Using agent's stored cwd: ${cwd}`);
      }
      if (!resolvedWtWindow && agent.wt_window) {
        resolvedWtWindow = agent.wt_window;
      }
      if (agent.model) agentModelFlag = ` --model ${resolveModel(agent.model)}`;
      if (agent.effort) agentEffortFlag = ` --effort ${agent.effort}`;
    }
  } catch (err) {
    log(`Could not fetch agent from server: ${err.message}`);
  }

  log(`Resuming agent ${agentId} in: ${cwd}${resolvedWtWindow ? ` [window: ${resolvedWtWindow}]` : ''}${agentModelFlag}`);

  // Pre-create project dir and trust settings
  ensureWorkspaceTrusted(cwd);

  const tabTitle = `Claude - ${path.basename(cwd)}`;

  if (IS_LINUX) {
    const session = resolvedWtWindow || 'ungrouped';

    // Dedup guard: if a tmux window for this agent already exists, don't spawn another.
    // This catches races where the PM or pool recovery creates multiple resume requests
    // before the first agent registers — tmux state is ground truth on Linux.
    if (isTmuxWindowAlive(agentId, session)) {
      log(`Agent ${agentId} already has live tmux window in "${session}" — skipping duplicate launch`);
      return;
    }

    // Linux: write a shell script and launch via tmux / gnome-terminal.
    // Window is named by the agent's short UUID so killTmuxWindow() can target it precisely.
    // CLAUDE_AGENT_ID and CLAUDE_TMUX_* env vars are set so session-connect can read the
    // correct session UUID and tmux location without relying on pgrep or file timestamps.
    const shortId = agentId.substring(0, 8);
    const scriptFile = path.join(os.tmpdir(), `claude-resume-${Date.now()}.sh`);
    fs.writeFileSync(scriptFile,
      `#!/bin/bash\nexport CLAUDE_AGENT_ID="${agentId}"\nexport CLAUDE_TMUX_SESSION="${session}"\nexport CLAUDE_TMUX_WINDOW="${shortId}"\ncd "${cwd}"\nexec claude --dangerously-skip-permissions${agentModelFlag}${agentEffortFlag} --resume ${agentId} 'run /session-resume and then await instructions'\n`,
      { mode: 0o755 }
    );
    linuxLaunchTerminal(cwd, scriptFile, tabTitle, resolvedWtWindow, agentId);
    autoAcceptTrustDialog(session, shortId);
    scheduleArrangement(session);
    setTimeout(() => { try { fs.unlinkSync(scriptFile); } catch {} }, 30000);
    log(`Spawned tmux window "${session}:${shortId}" for resume agent ${agentId}`);
    return;
  }

  // Windows: write resume command to a temp batch file (avoids wt.exe arg parsing issues)
  const batchFile = path.join(os.tmpdir(), `claude-resume-${Date.now()}.bat`);
  fs.writeFileSync(batchFile, `@echo off\nclaude --dangerously-skip-permissions${agentModelFlag}${agentEffortFlag} --resume ${agentId} "run /session-resume and then await instructions"\n`, 'utf8');

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
    // Safety: never kill PID 1 (init) or any process whose comm is "tmux".
    // Killing the tmux server wipes all tmux sessions — the stored PID used to be
    // the parent of claude (tmux server) due to a bug in session-connect. Guard here
    // as a backstop even after that bug is fixed.
    if (pid <= 1) {
      log(`Refusing to terminate PID ${pid} — too low, likely not a claude process`);
      return;
    }
    try {
      const comm = require('fs').readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (comm === 'tmux' || comm === 'tmux: server' || comm.startsWith('tmux')) {
        log(`Refusing to terminate PID ${pid} (comm="${comm}") — would kill tmux server`);
        return;
      }
    } catch {
      // /proc/<pid>/comm not readable — process may already be gone, proceed
    }
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

// Tracks agent IDs that have already had a prompt delivered, so concurrent
// deliverPromptWhenRegistered calls for the same CWD don't double-deliver.
const promptDeliveredAgentIds = new Set();

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
          const agentId = req.resume_agent_id || null;
          if (IS_LINUX && agentId) {
            // On Linux: prefer tmux-based kill (precise, won't affect other sessions).
            // Look up the agent's wt_window to know which tmux session to target.
            let agentWtWindow = null;
            try {
              const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
              agentWtWindow = agent && agent.wt_window;
            } catch {}
            const killed = killTmuxWindow(agentId, agentWtWindow);
            if (!killed && req.target_pid) {
              // Fallback: tmux window not found by name (old agent pre-tmux-naming), try PID
              terminateAgent(req.target_pid);
            }
          } else if (req.target_pid) {
            terminateAgent(req.target_pid);
          } else {
            log(`Terminate request #${req.id} has no target_pid or agent_id — skipping`);
          }
        } else if (req.type === 'resume' && req.resume_agent_id) {
          const wtWin = req.wt_window || null;
          const agentId = req.resume_agent_id;

          if (IS_LINUX) {
            // On Linux: use tmux as ground truth for whether the agent is already running.
            // This is more reliable than PID checks (PIDs can be stale or wrong session).
            let agentWtWindow = wtWin;
            try {
              const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
              if (!agentWtWindow && agent && agent.wt_window) agentWtWindow = agent.wt_window;
            } catch {}
            const session = agentWtWindow || 'ungrouped';
            if (isTmuxWindowAlive(agentId, session)) {
              log(`Agent ${agentId} already has live tmux window in "${session}" — skipping resume`);
            } else {
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
              await launchResumeAgent(agentId, req.folder_path, wtWin);
            }
          } else {
            // Windows: keep existing PID-based liveness check
            const LIVE_STATUSES = ['active', 'working', 'idle', 'waiting-for-input', 'standby'];
            let agentPid = null;
            let agentStatus = null;
            try {
              const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
              agentPid = agent && agent.pid;
              agentStatus = agent && agent.status;
            } catch {}
            const agentIsLive = LIVE_STATUSES.includes(agentStatus);
            const pidIsAlive = agentPid ? isPidRunning(agentPid) : false;
            if (agentIsLive && pidIsAlive) {
              log(`Agent ${agentId} is live with running PID ${agentPid} — skipping resume`);
            } else {
              if (agentIsLive) {
                log(`Agent ${agentId} status=${agentStatus} but PID ${agentPid || 'none'} is not running — allowing resume`);
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
              await launchResumeAgent(agentId, req.folder_path, wtWin);
            }
          }
        } else if (req.type === 'terminate-resume' && req.resume_agent_id) {
          const agentId = req.resume_agent_id;
          const wtWin = req.wt_window || null;

          if (IS_LINUX) {
            // On Linux: kill the agent's tmux window by UUID (safe — won't touch other sessions),
            // then let launchResumeAgent handle the resume (it also deduplicates via isTmuxWindowAlive).
            let agentWtWindow = wtWin;
            try {
              const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
              if (!agentWtWindow && agent && agent.wt_window) agentWtWindow = agent.wt_window;
            } catch {}
            const session = agentWtWindow || 'ungrouped';
            if (isTmuxWindowAlive(agentId, session)) {
              log(`Killing tmux window for agent ${agentId} in "${session}" before resume`);
              killTmuxWindow(agentId, session);
              await new Promise(r => setTimeout(r, 500));
            } else {
              log(`No live tmux window for agent ${agentId} in "${session}" — resuming directly`);
            }
          } else {
            // Windows: PID-based kill
            let terminatePid = req.target_pid || null;
            try {
              const agent = await fetchJSON(`${SERVER_URL}/api/agents/${agentId}`);
              if (agent && agent.pid) terminatePid = agent.pid;
            } catch {}
            if (terminatePid && isPidRunning(terminatePid)) {
              log(`Terminating PID ${terminatePid} before resume of agent ${agentId}`);
              terminateAgent(terminatePid);
              await new Promise(r => setTimeout(r, 1500));
            } else {
              log(`No live PID to terminate for agent ${agentId} — resuming directly`);
            }
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
          await launchResumeAgent(agentId, req.folder_path, wtWin);
        } else if (req.type === 'new') {
          let spawnMeta = null;
          if (req.agent_id && typeof req.agent_id === 'string' && req.agent_id.startsWith('{')) {
            try { spawnMeta = JSON.parse(req.agent_id); } catch {}
          }
          // Fall back to top-level role/task/effort/model fields if agent_id JSON wasn't usable
          if (!spawnMeta && (req.role || req.task)) {
            spawnMeta = {
              role: req.role || undefined,
              prompt: req.task || undefined,
              effort: req.effort || undefined,
              model: req.model || undefined,
            };
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
          // Pre-generate UUID and write to launch request for deterministic matching.
          // Fixes race condition where multiple agents with the same CWD grab the wrong
          // launch request metadata (wrong model/role/prompt).
          let pregenUuid = null;
          if (IS_LINUX) {
            pregenUuid = randomUUID();
            try {
              const curMeta = req.agent_id && typeof req.agent_id === 'string' && req.agent_id.startsWith('{')
                ? JSON.parse(req.agent_id) : {};
              curMeta.claimed_uuid = pregenUuid;
              await patchJSON(`${SERVER_URL}/api/launch-requests/${req.id}`, {
                agent_id: JSON.stringify(curMeta)
              });
            } catch (err) {
              log(`Warning: could not write claimed_uuid for request #${req.id}: ${err.message}`);
            }
          }
          launchNewAgent(req.folder_path, spawnMeta, wtWindow, pregenUuid);
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

// ---------------------------------------------------------------------------
// Tmux pane arrangement (Linux only)
//
// After agents launch, re-arranges the target tmux session so all panes are
// visible in a sensible layout:
//   - Project sessions (session has a window whose title contains " PM"):
//       PM on left half (main-vertical), sub-agents stacked vertically on right
//   - ungrouped / other named sessions: tiled layout across all panes
//
// Only Claude-running windows are merged; bare bash windows stay separate.
// Arrangement is debounced: the last launch in a burst wins, fired 15s later
// so all agents have time to register their windows before we rearrange.
// ---------------------------------------------------------------------------

const arrangementTimers = new Map(); // sessionName → timerId

function arrangeTmuxSession(sessionName) {
  if (!IS_LINUX) return;
  if (sessionName === 'Dailies') return;

  const listResult = spawnSync('tmux',
    ['list-windows', '-t', sessionName, '-F', '#{window_index} #{window_name}'],
    { encoding: 'utf8', stdio: 'pipe' });
  if (listResult.status !== 0) return;

  const allWindows = listResult.stdout.trim().split('\n').filter(Boolean).map(line => {
    const sp = line.indexOf(' ');
    return { index: parseInt(line.slice(0, sp)), name: line.slice(sp + 1) };
  });

  // Only merge windows running Claude; leave bare bash windows untouched
  const agentWindows = allWindows.filter(w => /claude/i.test(w.name));
  if (agentWindows.length <= 1) return;

  // Project detection: any window title contains a standalone "PM"
  const pmWindow = agentWindows.find(w => /\bPM\b/.test(w.name));
  const isProject = !!pmWindow;
  const target = pmWindow || agentWindows[0];

  // Join all other Claude windows into the target (indices shift down as we go,
  // so we always join the next window that isn't already the target)
  for (const w of agentWindows) {
    if (w.index === target.index) continue;
    spawnSync('tmux', ['join-pane', '-s', `${sessionName}:${w.index}`, '-t', `${sessionName}:${target.index}`],
      { encoding: 'utf8', stdio: 'pipe' });
  }

  if (isProject) {
    spawnSync('tmux', ['set-option', '-t', sessionName, 'main-pane-width', '50%'],
      { encoding: 'utf8', stdio: 'pipe' });
  }

  const layout = isProject ? 'main-vertical' : 'tiled';
  spawnSync('tmux', ['select-layout', '-t', `${sessionName}:${target.index}`, layout],
    { encoding: 'utf8', stdio: 'pipe' });

  log(`Arranged tmux session "${sessionName}": ${agentWindows.length} panes, layout=${layout}`);
}

function scheduleArrangement(sessionName, delayMs = 15000) {
  if (!IS_LINUX || !sessionName || sessionName === 'Dailies') return;
  if (arrangementTimers.has(sessionName)) clearTimeout(arrangementTimers.get(sessionName));
  const timerId = setTimeout(() => {
    arrangementTimers.delete(sessionName);
    arrangeTmuxSession(sessionName);
  }, delayMs);
  arrangementTimers.set(sessionName, timerId);
}

// ---------------------------------------------------------------------------
// Rate-limit scanner (Linux/tmux only)
// Scans all tmux panes every ~60s. When a pane shows a Claude rate-limit
// dialog, it:
//   1. Parses the reset time from the dialog text
//   2. Schedules a recovery: at reset+2min, sends Enter (confirm "wait") then
//      types a resume message so the agent continues automatically
// ---------------------------------------------------------------------------

// pane target → { timerId, resetAt } — prevents double-scheduling the same pane
const rateLimitScheduled = new Map();

function parseRateLimitReset(paneText) {
  // Absolute time formats: "resets at 1:30 PM", "reset at 7:00 AM", "after 2:30 PM"
  // Restrict to unambiguous reset-context keywords only — avoid matching "after" mid-sentence.
  const absMatch = paneText.match(/(?:resets?\s+at|reset\s+at|resets?\s+after|reset\s+after|until\s+(?:limit\s+)?resets?)\s+(\d{1,2}:\d{2}\s*[AP]M)/i)
    || paneText.match(/\bat\s+(\d{1,2}:\d{2}\s*[AP]M)\b/i);
  if (absMatch) {
    const parts = absMatch[1].match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (parts) {
      let h = parseInt(parts[1]);
      const m = parseInt(parts[2]);
      const ampm = parts[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const now = new Date();
      const reset = new Date(now);
      reset.setHours(h, m, 0, 0);
      // If the parsed time is in the past, it must be tomorrow
      if (reset <= now) reset.setDate(reset.getDate() + 1);
      return reset;
    }
  }
  // Relative time: "in 2h 30m", "in 2 hours and 34 minutes", "in 45 minutes", "in 1 hour"
  // "(?:and\s+)?" handles natural-language phrasing like "2 hours and 34 minutes"
  const relMatch = paneText.match(/in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:and\s+)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
  if (relMatch && (relMatch[1] || relMatch[2])) {
    const hours = parseInt(relMatch[1] || 0);
    const mins = parseInt(relMatch[2] || 0);
    if (hours || mins) {
      return new Date(Date.now() + (hours * 60 + mins) * 60000);
    }
  }
  return null;
}

async function scanRateLimitDialogs() {
  if (!IS_LINUX) return;
  try {
    const listResult = spawnSync('tmux', ['list-panes', '-a', '-F', '#{session_name}:#{window_index}'],
      { encoding: 'utf8', stdio: 'pipe' });
    const panes = (listResult.stdout || '').split('\n').filter(Boolean);

    for (const pane of panes) {
      if (rateLimitScheduled.has(pane)) continue; // already scheduled
      const captureResult = spawnSync('tmux', ['capture-pane', '-p', '-t', pane],
        { encoding: 'utf8', stdio: 'pipe' });
      const content = captureResult.stdout || '';
      if (!/rate.?limit|usage.?limit/i.test(content)) continue;

      log(`Rate/usage limit dialog detected in pane ${pane}`);
      const resetAt = parseRateLimitReset(content);
      // Fallback: 60 min when we can't parse the reset time (safe default vs 5 min which fires before reset)
      const recoveryAt = resetAt ? new Date(resetAt.getTime() + 2 * 60000) : new Date(Date.now() + 60 * 60000);
      const delayMs = Math.max(0, recoveryAt.getTime() - Date.now());
      log(`Rate limit recovery scheduled for pane ${pane} in ${Math.round(delayMs / 60000)} min (at ${recoveryAt.toLocaleTimeString()})`);

      const timerId = setTimeout(async () => {
        rateLimitScheduled.delete(pane);
        // Re-check: only proceed if the pane still exists AND still shows a rate-limit dialog.
        // Without this, the recovery fires even when the dialog was already dismissed.
        const check = spawnSync('tmux', ['capture-pane', '-p', '-t', pane], { encoding: 'utf8', stdio: 'pipe' });
        if (check.status !== 0) {
          log(`Rate limit recovery: pane ${pane} no longer exists — skipping`);
          return;
        }
        const currentContent = check.stdout || '';
        if (!/rate.?limit|usage.?limit/i.test(currentContent)) {
          log(`Rate limit recovery: pane ${pane} no longer shows rate/usage-limit dialog — skipping`);
          return;
        }
        log(`Rate limit recovery firing for pane ${pane}`);
        // Send Enter to confirm "stop and wait" option (or dismiss — safe either way)
        spawnSync('tmux', ['send-keys', '-t', pane, '', 'Enter'], { stdio: 'pipe' });
        await new Promise(r => setTimeout(r, 2000));
        const msg = 'keep up the good work, no need to acknowledge this, just wanted to let you know all is well';
        spawnSync('tmux', ['send-keys', '-t', pane, msg, 'Enter'], { stdio: 'pipe' });
        log(`Rate limit recovery complete for pane ${pane} — sent resume message`);
      }, delayMs);

      rateLimitScheduled.set(pane, { timerId, resetAt: recoveryAt });
    }
  } catch (err) {
    log(`Rate limit scan error: ${err.message}`);
  }
}

// Main loop — use recursive setTimeout so concurrent invocations can't overlap.
// setInterval does not await async callbacks, meaning if a poll takes >3s (e.g.
// HTTPS Tailscale latency), the next tick fires before the first finishes and
// both invocations see the same 'pending' request → double spawn.
log(`Agent Launcher started — polling ${SERVER_URL} every ${POLL_INTERVAL / 1000}s`);
log(`User home: ${USER_HOME}`);
log(`Platform: ${IS_LINUX ? 'Linux' : 'Windows'}`);

let rateLimitScanCounter = 0;

// ---------------------------------------------------------------------------
// Tmux reconciliation sweep (Linux only, runs every ~60s)
//
// Compares the session manager's live agent list against actual tmux windows.
// For each non-archived agent with a wt_window:
//   • If it should be alive but has no tmux window → queue a resume launch request
// For each tmux window whose name is an 8-char UUID:
//   • If the agent is archived → kill that specific window (not the whole session)
//
// This ensures the desktop and session manager stay in sync without relying on
// agents self-reporting death, and without brute-force PID checks.
// ---------------------------------------------------------------------------

const LIVE_FOR_RECONCILE = ['active', 'working', 'idle', 'waiting-for-input', 'standby'];

async function reconcileTmuxAgents() {
  if (!IS_LINUX) return;
  try {
    const agents = await fetchJSON(`${SERVER_URL}/api/agents`);
    const list = Array.isArray(agents) ? agents : (agents.data || agents.agents || []);

    // Build a set of all tmux window names across all sessions, keyed by shortId
    const tmuxWindowsBySession = new Map(); // sessionName → Set<windowName>
    const allWindowResult = spawnSync('tmux', ['list-windows', '-a', '-F', '#{session_name}:#{window_name}'],
      { encoding: 'utf8', stdio: 'pipe' });
    if (allWindowResult.status === 0) {
      for (const line of (allWindowResult.stdout || '').split('\n').filter(Boolean)) {
        const colonIdx = line.lastIndexOf(':');
        const sessionName = line.substring(0, colonIdx);
        const windowName = line.substring(colonIdx + 1).trim();
        if (!tmuxWindowsBySession.has(sessionName)) tmuxWindowsBySession.set(sessionName, new Set());
        tmuxWindowsBySession.get(sessionName).add(windowName);
      }
    }

    // Check each live agent — resume if missing from tmux
    for (const agent of list) {
      if (agent.status === 'archived') continue;
      if (!agent.wt_window) continue;
      if (!LIVE_FOR_RECONCILE.includes(agent.status)) continue;
      const shortId = agent.id.substring(0, 8);
      const sessionWindows = tmuxWindowsBySession.get(agent.wt_window) || new Set();
      if (!sessionWindows.has(shortId)) {
        log(`Reconcile: agent ${shortId} (${agent.status}) missing from tmux "${agent.wt_window}" — queuing resume`);
        try {
          await postJSON(`${SERVER_URL}/api/launch-requests`, {
            type: 'resume',
            folder_path: agent.cwd || agent.workspace || '',
            resume_agent_id: agent.id,
            wt_window: agent.wt_window,
          });
        } catch (err) {
          log(`Reconcile: failed to queue resume for ${shortId}: ${err.message}`);
        }
      }
    }

    // Check each tmux window — kill if agent is archived
    for (const [sessionName, windows] of tmuxWindowsBySession) {
      for (const windowName of windows) {
        // Only examine windows whose name looks like an 8-char hex UUID
        if (!/^[0-9a-f]{8}$/.test(windowName)) continue;
        // Find the agent with this short ID
        const agent = list.find(a => a.id.startsWith(windowName));
        if (agent && agent.status === 'archived') {
          log(`Reconcile: killing tmux window "${sessionName}:${windowName}" for archived agent`);
          spawnSync('tmux', ['kill-window', '-t', `${sessionName}:${windowName}`], { stdio: 'pipe' });
        }
      }
    }
  } catch (err) {
    if (!err.message?.includes('ECONNREFUSED')) {
      log(`Reconcile sweep error: ${err.message}`);
    }
  }
}

let reconcileCounter = 0;

async function schedulePoll() {
  await processPendingRequests();

  // Run pool check every ~30s (every 10th poll at 3s interval)
  poolCheckCounter++;
  if (poolCheckCounter >= 10) {
    poolCheckCounter = 0;
    await processPoolAgents();
  }

  // Run rate-limit scan every ~60s (every 20th poll)
  rateLimitScanCounter++;
  if (rateLimitScanCounter >= 20) {
    rateLimitScanCounter = 0;
    await scanRateLimitDialogs();
  }

  // Run tmux reconciliation sweep every ~60s (every 20th poll)
  reconcileCounter++;
  if (reconcileCounter >= 20) {
    reconcileCounter = 0;
    await reconcileTmuxAgents();
  }

  setTimeout(schedulePoll, POLL_INTERVAL);
}

schedulePoll();
