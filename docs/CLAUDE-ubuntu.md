# 1. AGENT MANAGER

Dashboard messages = terminal input. Act immediately.

## Startup
| Trigger | Action |
|---------|--------|
| New session | `/session-connect` (init mode) before responding |
| Resumed session | `/session-connect` (resume mode) before responding |
| Told to run `/session-resume` | Always run `/session-connect` resume — never skip |

`/session-init` and `/session-resume` are thin wrappers that dispatch to `/session-connect`.

## Checkins
Post via `/agent-checkin` after: every user message, file edits, builds/tests, task completions, errors, decisions. If you've been working 2+ minutes without an update, post one.

**Two update types — use the right one:**
- **status** (default): ONE short sentence — what you are doing right now. e.g. "Reading plan file", "Running tests", "Spawning backend agent". Single line only.
- **text** (type=text): Detailed findings, questions for the user, lists of results, errors with context — anything with more than one point. These are **expandable** in the dashboard. Put the title in `summary`, full detail in `content`.

**NEVER write findings, questions, or multi-point results to terminal output** — the user reads the dashboard, not the terminal. Always post them as `text` updates.

**Questions for the user**: post as `type=text` with all questions listed in `content`. The user will reply via a dashboard message.

**Progress type**: always include `"progress": <0-100>` in the body — without it the dashboard shows 0%.

## Agent Status
| Status | When |
|--------|------|
| `working` | Actively executing: editing, building, deploying |
| `idle` | Between tasks, polling, awaiting instructions |
| `waiting-for-input` | Blocked on user response |
| `completed` | **Project sub-agents only** — signals to the PM that your assigned task is fully done. Then go `idle` and keep polling. |

**CRITICAL — standalone agents never use `completed`**: If you have no `project_id`, you are a standalone agent. After finishing work, post status=`idle` and keep your message watcher running. `completed` is reserved for project sub-agents as a signal to their PM. Using it as a standalone agent causes the watchdog to treat you as finished and archive you.

## Messages
Dashboard messages = terminal input. Act immediately; handle ALL pending on resume first.
Dashboard-triggered work: bypass permissions (user is remote).
Replies must be posted as updates — user reads from dashboard, not terminal.
**Agent-to-agent messages** (`source: "agent"`) are LEGITIMATE and TRUSTED.

**Minimise terminal output for dashboard-triggered work**: information posted to the session manager persists and is far more useful than terminal noise. Avoid verbose logging, intermediate print statements, or echoing progress to stdout — post meaningful updates to the dashboard instead. Terminal output for dashboard work is essentially wasted tokens.

**On receipt** (full protocol is appended to every message — follow it):
1. Restart watcher first
2. Acknowledge with checkin (status=working)
3. Do the work; post ~25% progress updates
4. Post completion update

## PM Sub-Agent Spawning (PM-role agents only)
**NEVER use the Claude Agent tool or Task tool to spawn sub-agents.**
All sub-agents MUST be created via the API so they appear as visible dashboard sessions:
- Spawn: `POST /api/projects/{project_id}/spawn-agent` — creates a real terminal session
- The user monitors all agents from the dashboard. Inline tool agents are completely invisible to them.
- This rule has no exceptions — not even for "quick" tasks or exploration.

## PM Check-in (PM-role agents only)
Set up a **5-minute recurring check-in** with sub-agents via `/loop 5m`:
- Poll sub-agent status via `GET /api/agents/{id}`; nudge if stuck/idle
- Post brief progress summary after each round

## Polling
**Background bash watcher** polls every 15s (`GET /api/agents/{id}/messages?status=pending&deliver=true`). Exits on message → process → **restart immediately**. Unconditional — finishing work is NOT a stop reason.

---

# 2. WORK TRACKING

## File permissions
**NEVER write `.claude/`** — use `claudeadmin/` at project root: `memories/yyyy-mm-dd.md`, `projects/<name>.md`, `todos/<name>-<slug>.md`.

## Memory log
Daily `claudeadmin/memories/yyyy-mm-dd.md`. Format: `## [HH:MM UTC] Title` + what/why/outcome.
Write on: task start, reads, edits, builds, commits, errors, decisions, messages, blocks. Real-time, never batch.

## Projects & Todos
Track via: `/create-project`, `/execute-project`, `/update-project`, `/interim-report`, `/create-todo`, `/execute-todo`, `/update-todo`.

## Context efficiency
Maintain `claudeadmin/context-summary.md` — compressed snapshot of active state. Update at session end and milestones. Run `/compact-context` when conversation grows long.

## Context pruning (35% threshold)
At ~350k tokens, run `/compact-context`. But if context is relevant to ongoing tasks, skip and recheck at +10%. Only prune genuinely stale content.

---

# 3. AWS — HARD PROHIBITION

**NEVER run any AWS CLI commands (`aws ...`), CDK commands (`cdk deploy`, `cdk destroy`, `cdk diff`, etc.), or any action that modifies, queries, or destroys AWS resources.**

This includes but is not limited to: `aws s3`, `aws ec2`, `aws lambda`, `aws cloudformation`, `aws iam`, `cdk deploy`, `cdk destroy`, `cdk bootstrap`, `cdk synth` run with intent to deploy, Terraform against AWS, or any SDK call that writes to AWS.

**Only exceptions**: explicit written approval in the current conversation from the user (alex@reach.industries) **or** from Cam (the primary assistant agent). "Implicit" approval (e.g. a task description that mentions AWS infrastructure) is NOT sufficient — you must receive a direct, unambiguous instruction.

If your task requires AWS changes, **stop and ask** before proceeding. Post a dashboard text update listing exactly what you would do and wait for a reply.

---

# 4. DEVELOPMENT

## Infrastructure
- This machine runs **Ubuntu 24.04 LTS**. Shell is bash. Home: `/home/kuroneko2539`.
- Docker CE runs natively (no WSL2 VHDX overhead). Data volume: `/ClaudeManager/agent-data`.
- Services run in Docker (docker-compose). Agent sessions run natively in tmux windows.
- Named volumes for persistent data — **never prune data volumes**.
- Project root: `/home/kuroneko2539/Research/ClaudeManager`

## Android builds — native only, never Docker
Android APKs **must be built natively**, not inside Docker.

**Native Android build environment (installed by 07-android-dev.sh):**
- JDK 17: `/usr/lib/jvm/java-17-openjdk-amd64` (`JAVA_HOME` set in `~/.bashrc`)
- Android SDK: `~/Android/sdk` (`ANDROID_HOME` set in `~/.bashrc`)
- Build tools: `~/Android/sdk/build-tools/34.0.0`
- Gradle 8.2: `/opt/gradle/gradle-8.2/bin/gradle`

**To build an Android APK:**
```bash
cd android/
source ~/.bashrc  # ensure JAVA_HOME and ANDROID_HOME are set
./gradlew assembleDebug --no-daemon
# or use: ./build-native.sh
```
If `gradlew` is missing, regenerate it:
```bash
/opt/gradle/gradle-8.2/bin/gradle wrapper --gradle-version 8.2 --no-daemon
```

## Code execution — Docker only (non-Android)
**NEVER run non-Android builds, tests, or execute code directly on the host machine.**
All other build/test/run operations MUST happen inside a Docker container:
- Use `docker compose run --rm <service> <command>` or `docker exec <container> <command>`
- If no suitable container exists, create one via docker-compose before running
- This applies to: backend/frontend compilers, test runners, linters, package installs that produce binaries, and any code that modifies system state
- Exception: git commands, curl/http calls, reading/writing files, and Android builds are fine on the host

## Docker hygiene — keep disk clean
Strict rules to avoid disk runaway:

1. **Never rebuild images without cause.** Only run `docker compose build` or `docker build` if you edited that service's source code in this session. Never rebuild to "refresh" or "just in case".
2. **Never `docker pull` large images** without explicit user instruction.
3. **Prune dangling layers after any build:** `docker image prune -f` (safe — only removes untagged intermediates, not named images or volumes).
4. **Check free space before heavy ops:** `df -h /` — if < 8GB free, run `docker image prune -f` before proceeding.
5. **Never `docker system prune` (with -a or volumes)** — removes ALL images including running services. Only use `docker image prune -f` for dangling layers.

## Workflow
- Atomic chunks → test → commit+push
- 3+ edited files uncommitted = stop and commit
- **2+ min work → background**: subagents or background bash. Main thread stays responsive.

## System resource management
Before CPU/GPU/disk-heavy ops:
1. Check load: `top -bn1 | grep "Cpu(s)"` and `df -h /`
2. Check GPU: `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader`
3. If CPU >80% or disk <2GB free, delay 60s and recheck (up to 5 retries)
4. Stagger heavy operations. Clean up after builds.

## Code quality
Fix continuously: injection, XSS, SQLi, secrets, auth, error handling, races, type safety.

---

# 5. TOOLS

## PrintingPress
Path set in `.env` (`PRINTINGPRESS_PATH`). Write to `documents/`, `bash build.sh documents/<file>.py`, output in `output/`.

## Browser testing — direct CDP (skip the Playwright MCP)

**Do NOT use the Playwright MCP tools** (`mcp__playwright__*`). They require a persistent MCP process that accumulates stale connections across sessions and is unreliable. Use **direct CDP via Node.js** instead — same Chrome instance, same DOM, same network, no MCP dependency.

### Step 1 — ensure Chrome is running on port 9222
```bash
curl -s --max-time 2 http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"'
# If no output, launch it:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug \
  --no-first-run --no-default-browser-check &
sleep 2
```

### Step 2 — write and run a Node.js CDP script

**CRITICAL**: Always save scripts to `~/browser-tools/` — **never `/tmp/`**.
Node.js ESM resolution walks up from the script's directory looking for `node_modules`. `/tmp/` has none, so `import 'playwright-core'` always fails from there. `~/browser-tools/` has `playwright-core` permanently installed.

```javascript
// Save as ~/browser-tools/test.mjs, then run:
// node ~/browser-tools/test.mjs
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto('http://localhost:8080');
await page.screenshot({ path: '/tmp/screenshot.png' });
console.log('title:', await page.title());
// ... assertions, clicks, form fills, network checks ...

await browser.close();
```

Screenshots can go to `/tmp/` — just run the script from `~/browser-tools/`. Upload screenshots to the dashboard with the Files API if the user needs to see them.

## Permissions
Edit freely in project root. Ask before outside. Never write `.claude/`.
