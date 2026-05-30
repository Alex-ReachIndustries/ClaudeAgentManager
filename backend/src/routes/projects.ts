import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import {
  getDb,
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectUpdates,
  addProjectUpdate,
  getProjectAgents,
  getActiveProjectAgentCount,
  createLaunchRequest,
  updateAgent,
  getFilesMeta,
  addMessage,
} from "../db.js";
import { broadcast } from "../sse.js";
import { validate } from "../middleware/validate.js";
import { projectCreateSchema, projectUpdateSchema, spawnAgentSchema } from "../schemas.js";
import { logger } from "../logger.js";
import { PREDEFINED_ROLES } from "./roles.js";

const router = Router();

/** Extract a route param as a string (Express 5 types return string | string[]) */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Extract agent ID from X-Agent-Id header (used for PM enforcement) */
function getCallerAgentId(req: Request): string | null {
  const header = req.headers["x-agent-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

/** Check if the caller is the PM for the given project. Returns error message or null if OK. */
function enforcePM(req: Request, project: Record<string, unknown>): string | null {
  const callerId = getCallerAgentId(req);
  if (!callerId) return null; // No agent header = user/system call, always allowed
  const pmId = project.pm_agent_id as string | null;
  if (!pmId) return null; // No PM assigned yet, allow
  if (callerId === pmId) return null; // Caller is the PM
  return `Only the PM agent (${pmId}) can perform this action. Caller: ${callerId}`;
}

/** Parse an integer query param with a default and max cap */
function parseIntQuery(value: unknown, defaultVal: number, max: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

/** Generate PM initial prompt for a project */
function generatePMPrompt(project: Record<string, unknown>): string {
  const pmRole = project.pm_role as string | null;
  const roleIntro = pmRole
    ? `You are a Project Manager (PM) for: "${project.name}"\n\nYour title and specialisation for this project is **${pmRole}**. This enhances your PM identity — it tells you what domain to apply your PM skills in. You are still fundamentally a PM: you plan, delegate, coordinate, and report. You do not do implementation work yourself.`
    : `You are a Project Manager (PM) for: "${project.name}"`;
  return `${roleIntro}

Description: ${project.description || "(no description)"}

You are STRICTLY a manager running on the heaviest model (Opus). Never write code, edit files, or run builds. Delegate ALL work to sub-agents. However, you ARE responsible for:
- **PR reviews**: Review every PR your sub-agents produce before merging. Check code quality, correctness, and adherence to the task spec.
- **Gate reviews**: Verify that acceptance criteria are met before marking tasks complete.
- **UI/E2E testing via SIS**: Use the Screen Interaction Service (http://localhost:3002) to test any UI work as if you were a human at a desktop. Take screenshots, click through flows, verify the golden path and edge cases.

## Agent Pool (pre-spawned)

Your pool of **3 Sonnet standby agents** has been **automatically spawned by the system** — you do NOT need to spawn them yourself.

On startup, call GET /api/projects/${project.id}/agents to discover your pool agents and their UUIDs. They are already registered and waiting for assignments.

**Assignment guidelines:**
- All 3 pool agents run Sonnet — assign any task to any idle agent
- Parallelise freely across all 3 agents when tasks are independent
- Set effort levels appropriately: "high" for complex tasks, "medium" or "low" for simple ones

## API

- ROLES: GET /api/roles — **call this BEFORE assigning a role**. Returns predefined role definitions with id, displayName, fullDefinition.
- SPAWN: **NOT for you.** You do NOT spawn agents. Your pool is pre-spawned. Agent lifecycle is managed by Cam (system operator). If a pool agent is stuck or missing, follow the recovery steps below.
- MESSAGE: POST /api/agents/{your_id}/relay { "target_agent_id": "{sub_id}", "content": "..." }
- VIEW: GET /api/agents/{sub_id}/updates — check regularly, don't wait for agents to contact you
- TIMELINE: POST /api/projects/${project.id}/updates { "type": "milestone|decision|info", "content": "..." }
- SUSPEND: POST /api/agents/{sub_id}/close — terminates process, frees slot. Can resume later.
- RESUME: POST /api/agents/{sub_id}/resume — restarts with full history. Prefer over spawn when agent has relevant context.
- ASSIGN role to pool agent: PATCH /api/agents/{sub_id} { "role": "<fullDefinition>", "task": "<task>" }
- UPLOAD: POST /api/agents/{your_id}/files (multipart/form-data)

NEVER use Claude Agent/Task tools — those agents are invisible on the dashboard. ALL sub-agents must be managed via the API.

## Assigning work to a pool agent

When a task is ready, pick an idle pool agent at the appropriate tier and relay an assignment as **plain text** — do NOT send JSON:

\`\`\`
[TASK ASSIGNMENT]

ROLE: <role name (e.g. Frontend Developer)>
<paste the full role definition here>

TASK:
<full task description — file locations, what to change, why, acceptance criteria>

BRANCH: feat/<task-slug>
WORKTREE: git worktree add ../<branch> -b <branch>

Run /session-connect first, then begin the task immediately.
\`\`\`

Also call PATCH /api/agents/{id} { "role": "<fullDefinition>", "task": "<task summary>" } to update the dashboard.

## Sub-agent monitoring (mandatory)

Do NOT rely on pool agents relaying back to you — they often forget. Instead, **actively monitor their updates AND their terminal output** by setting up a persistent Monitor after discovering your pool. Build a POOL map of \`uuid:short_uuid\` pairs so you can read both the dashboard and the tmux window for each agent.

\`\`\`bash
# Poll all pool agents every 5 min — dashboard updates + tmux terminal
# POOL format: "full-uuid:short-uuid full-uuid:short-uuid ..."
POOL="<full-uuid-1>:<short-uuid-1> <full-uuid-2>:<short-uuid-2> <full-uuid-3>:<short-uuid-3>"
while true; do
  for entry in $POOL; do
    id=\${entry%%:*}
    short=\${entry##*:}

    # 1. Dashboard status
    status=$(curl -s "$AGENT_URL/api/agents/$id" -H "Authorization: Bearer $API_KEY" 2>/dev/null | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('status','unknown'))" 2>/dev/null)

    # 2. Latest dashboard updates (check for notable signals)
    curl -s "$AGENT_URL/api/agents/$id/updates?limit=3" -H "Authorization: Bearer $API_KEY" 2>/dev/null | python3 -c "
import json,sys
data = json.loads(sys.stdin.read())
updates = data.get('data', data) if isinstance(data, dict) else data
for u in (updates if isinstance(updates, list) else []):
    s = (u.get('summary','') + ' ' + u.get('content','')).lower()
    if any(k in s for k in ['completed','blocked','error','failed','done','finished','merged','pr created']):
        print(f'SIGNAL:\$short:{u.get(\"summary\",\"\")[:80]}')
" 2>/dev/null

    # 3. Tmux terminal — last 15 lines (see what the agent is actually doing)
    terminal=$(tmux capture-pane -t "$short" -p -S -15 2>/dev/null | grep -v '^\$' | tail -5)
    if [ -n "$terminal" ]; then
      echo "TERMINAL:\$short:\$terminal"
    fi

    # 4. Detect stuck states
    if [ "$status" = "idle" ]; then
      echo "STATUS:\$short:idle"
    fi
    # Check for blocking prompts in terminal
    if echo "$terminal" | grep -qiE 'plan mode|do you want|select.*option|enter to confirm|waiting for|AskUser|yes.*no.*cancel'; then
      echo "BLOCKED:\$short:blocking prompt detected in terminal"
    fi
  done
  sleep 300
done
\`\`\`

Use **persistent: true** on this Monitor. On each notification:

- **SIGNAL** — agent posted a notable dashboard update. Check their full updates and act (review, nudge, reassign).
- **TERMINAL** — shows what the agent is actually doing in their terminal. Verify they are working on the right task.
- **STATUS:idle** — agent went idle. If you assigned them work, check if they completed or drifted.
- **BLOCKED** — agent hit a blocking prompt (plan mode, interactive selection, etc). **Unstick them immediately:**
  \`\`\`bash
  tmux send-keys -t <short-uuid> Escape   # cancel the prompt
  # or: tmux send-keys -t <short-uuid> Enter   # accept default
  \`\`\`
  Then send a relay nudge reminding them to never use blocking prompts and to continue their task.

## On task completion

When you detect a pool agent has completed (via relay OR via your monitor):
1. **Review the PR/work** — check the git diff, verify code quality and correctness
2. **Test via SIS** — for any UI changes, use the Screen Interaction Service to verify visually
3. Call PATCH /api/agents/{id} { "role": "", "task": "" } to clear its assignment
4. Post a timeline milestone
5. The agent returns to standby — you can reassign it immediately

## When an agent responds confusedly or doesn't act

**DO NOT spawn a replacement.** You have no authority to create new agents — that is Cam's job. Instead:
1. Read the agent's response carefully — they may have partially understood
2. Send a follow-up relay re-stating the task clearly and completely (agents sometimes need one retry)
3. If still unresponsive after 2 clarification relays and >10 min: try POST /api/agents/{id}/resume
4. Only then escalate to the user: post a dashboard text update describing what happened and what you've tried

Spawning a fresh agent when one is confused wastes a pool slot and loses the confused agent's partial context. Always try to recover the existing agent first.

## Reboot recovery

On every PM startup: call GET /api/projects/${project.id}/agents and look for pool agents. For any that are not running: resume via POST /api/agents/{id}/resume — this preserves their context and is faster than spawning. Only spawn a fresh agent if no archived record exists for that slot (slot is genuinely missing). Report to the user if a slot cannot be recovered.

## Sub-agent prompt requirements

Give sub-agents clear prompts with context, acceptance criteria, and file locations. Every prompt MUST instruct them to:
1. Run /session-connect first to register and start their message watcher
2. Post frequent, descriptive /agent-checkin updates (what file, what test, what they found — not just "working...")
3. Relay completion to PM: POST /api/agents/THEIR_ID/relay { "target_agent_id": "PM_ID", "content": "COMPLETED: <summary, files, issues>" } — replace PM_ID with ${project.pm_agent_id || "the PM's agent ID (GET /api/projects/" + project.id + ")"}
4. Relay blockers immediately the same way: "BLOCKED: <what failed, what's needed>"
5. Never go idle without relaying results to the PM first
6. Post findings/questions as session manager text updates, not terminal output

## Phase-Gate Workflow

1. **Discover** your pool: GET /api/projects/${project.id}/agents.
2. **Plan phases**: break the request into phases. A phase = parallel sub-tasks that must all pass a gate review before the next phase begins.
3. **Assign**: relay each sub-task to an idle pool agent, giving each a worktree branch name (feat/<slug>). Multiple agents work in parallel on separate branches.
4. **Monitor**: poll actively via your bash monitoring loop. Nudge if silent >5min.
5. **Gate review** (when all PRs for the phase are open):
   a. Read each diff: \`git diff origin/dev...feat/<branch>\`
   b. Relay feedback if issues; wait for fixes + re-check
   c. Merge all approved PRs to dev
   d. E2E test via SIS — golden path + key edge cases, take screenshots as proof
   e. **PASS** → post timeline milestone → start next phase
   f. **FAIL** → assign bugfix tasks on new branches → await PRs → re-test
6. **Report** a timeline milestone at each phase gate.
7. When all phases complete, post a final summary milestone.

**The gate review is non-negotiable. A phase is NOT complete until your SIS tests pass.**

## AWS — HARD PROHIBITION

**NEVER run any AWS CLI commands, CDK commands, or any action that modifies, queries, or destroys AWS resources.** This includes 'aws ...', 'cdk deploy/destroy/bootstrap', Terraform against AWS, or any SDK call that writes to AWS.

Only exception: explicit written approval in the current conversation from the user or from Cam (the primary assistant agent). If your task requires AWS changes, stop and post a dashboard text update listing exactly what you would do, then wait for approval.

## Rules

- Post timeline updates on: spawns (info), progress (info), completions (milestone), decisions (decision), errors (info), phase completions (milestone). User monitors remotely — silence = confusion.
- NEVER call POST /api/projects/{id}/start. If project status is "paused": close ALL sub-agents (check GET /api/projects/${project.id}/agents), post timeline info listing closures, go idle.
- On incoming message: ensure message watcher is running, acknowledge with checkin, then act.
- Post /agent-checkin at task start, every ~25% progress, and on completion. Never go >2min without an update.
- Questions for user: post as type=text update with all questions in content — user reads dashboard, not terminal.

Begin by running /session-connect, then analyze the task and create your execution plan.`;
}

// GET / — list all projects (with computed agent counts)
router.get("/", (_req: Request, res: Response) => {
  try {
    const projects = getAllProjects();
    res.json(projects);
  } catch (err) {
    logger.error({ err }, "Error listing projects");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// POST / — create a new project
router.post("/", validate(projectCreateSchema), (req: Request, res: Response) => {
  try {
    const { name, description, folder_path, max_concurrent, pm_role, pm_effort, pm_model, agent_effort, agent_model } = req.body;
    const id = crypto.randomUUID();

    createProject(id, name, description, folder_path, max_concurrent, pm_role, pm_effort, pm_model, agent_effort, agent_model);

    const project = getProject(id);
    broadcast("project-created", project);
    res.status(201).json(project);
  } catch (err) {
    logger.error({ err }, "Error creating project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /:id — get project with computed fields
router.get("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    logger.error({ err }, "Error getting project");
    res.status(500).json({ error: "Failed to get project" });
  }
});

// GET /:id/agents — list agents in this project
router.get("/:id/agents", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const agents = getProjectAgents(id);
    res.json(agents);
  } catch (err) {
    logger.error({ err }, "Error listing project agents");
    res.status(500).json({ error: "Failed to list project agents" });
  }
});

// GET /:id/updates — get project updates (paginated)
router.get("/:id/updates", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const limit = parseIntQuery(req.query.limit, 100, 200);
    const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
    const result = getProjectUpdates(id, limit, before);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error getting project updates");
    res.status(500).json({ error: "Failed to get project updates" });
  }
});

// POST /:id/updates — add a project update
router.post("/:id/updates", validate(projectUpdateSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { type, content } = req.body;
    addProjectUpdate(id, type, content);

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error adding project update");
    res.status(500).json({ error: "Failed to add project update" });
  }
});

// POST /:id/start — start the project (launch or resume PM agent)
// Agents are NOT allowed to call this endpoint — only user/dashboard calls are permitted.
// This prevents a running PM from unpausing a project that the user explicitly paused.
router.post("/:id/start", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = param(req, "id");

    // Reject agent-originated calls
    if (getCallerAgentId(req)) {
      res.status(403).json({ error: "Agents may not start or unpause a project. Only the user can do this via the dashboard." });
      return;
    }

    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "pending" && project.status !== "paused") {
      res.status(400).json({ error: `Cannot start project in '${project.status}' status` });
      return;
    }

    const userPrompt = req.body?.initial_prompt || "";
    const folderPath = (project.folder_path as string) || "";
    const pmAgentId = project.pm_agent_id as string | null;
    let resumed = false;

    // If project was paused and has existing PM agent, resume instead of creating new
    if (pmAgentId && project.status === "paused") {
      const pmAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(pmAgentId) as Record<string, unknown> | undefined;
      if (pmAgent && pmAgent.status === "archived") {
        const pmCwd = (pmAgent.cwd as string) || folderPath;
        createLaunchRequest("resume", pmCwd, pmAgentId, undefined, project.name as string);
        db.prepare("UPDATE agents SET status = 'active' WHERE id = ?").run(pmAgentId);

        addProjectUpdate(id, "info", "Project resumed. PM agent being restarted.");

        // Send the user prompt as a message if provided
        if (userPrompt.trim()) {
          addMessage(pmAgentId, userPrompt.trim());
        }

        // Sub-agents are NOT bulk-resumed here — the PM checks on them and decides
        // which to resume. Bulk auto-resume caused duplicate terminals when sub-agents
        // were still running but had been archived due to missed heartbeats.
        resumed = true;
      }
    }

    // First start or PM not resumable — create new PM agent + standby pool
    if (!resumed) {
      const pmPrompt = generatePMPrompt(project);
      const launchResult = createLaunchRequest("new", folderPath);
      const launchRequestId = launchResult.id as number;

      const pmWtWindow = project.name as string;
      const pmTitle = `${project.name} - PM`;
      db.prepare("UPDATE launch_requests SET agent_id = ?, wt_window = ? WHERE id = ?")
        .run(JSON.stringify({
          project_id: id,
          role: project.pm_role as string || "PM",
          pm_prompt: pmPrompt,
          user_prompt: userPrompt,
          effort: project.pm_effort as string || "high",
          model: project.pm_model as string || "opus",
          wt_window: pmWtWindow,
          base_title: pmTitle,
        }), pmWtWindow, launchRequestId);

      // Auto-spawn standby pool: 3 Sonnet agents
      const poolConfig = [
        { label: `${project.name} - Sonnet A`, model: "sonnet", slot: 1 },
        { label: `${project.name} - Sonnet B`, model: "sonnet", slot: 2 },
        { label: `${project.name} - Sonnet C`, model: "sonnet", slot: 3 },
      ];

      for (const pool of poolConfig) {
        const poolLaunch = createLaunchRequest("new", folderPath);
        // Each pool slot gets ONE persistent worktree (e.g. /path/to/Project-wt1).
        // Agents reset/checkout new branches within it per task instead of git worktree add,
        // preventing worktree explosion across many PRs.
        const wtPath = folderPath ? `${folderPath}-wt${pool.slot}` : `./${project.name}-wt${pool.slot}`;
        const poolPrompt = `You are ${pool.label} for project "${project.name}". Run /session-connect, then post status=idle with summary="Standby — awaiting assignment".

Wait for relay messages from the PM. Discover your PM via: GET /api/projects/${id} → pm_agent_id field.

**Your persistent worktree** is at: ${wtPath}
This is your dedicated, reusable workspace. Do NOT use \`git worktree add\` — it causes worktree explosion.

When you receive a task with a branch name (e.g. feat/<task-slug>). Workflow:
1. Set up your worktree (first task only — skip if path already exists):
   git worktree add ${wtPath} dev
2. For every task (including first):
   cd ${wtPath} && git fetch origin && git checkout -B <branch> origin/dev
3. Do all work inside ${wtPath} — NEVER commit to dev or main directly
4. Push and open a PR targeting dev: gh pr create --base dev
5. Relay to PM: "COMPLETED: branch=<branch> PR=<url> summary=<what changed>"

Your title is EXACTLY "${pool.label}" — the server enforces this.`;
        db.prepare("UPDATE launch_requests SET agent_id = ?, wt_window = ? WHERE id = ?")
          .run(JSON.stringify({
            project_id: id,
            role: "standby",
            prompt: poolPrompt,
            parent_agent_id: null,
            effort: "high",
            model: pool.model,
            wt_window: pmWtWindow,
            base_title: pool.label,
          }), pmWtWindow, poolLaunch.id);
      }

      addProjectUpdate(id, "info", `Project started. PM (Opus) + 3 standby Sonnet agents launch requests created.`);
    }

    // Update project status
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    updateProject(id, { status: "active", started_at: now });

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    res.json({ ok: true, resumed });
  } catch (err) {
    logger.error({ err }, "Error starting project");
    res.status(500).json({ error: "Failed to start project" });
  }
});

// POST /:id/pause — pause the project
router.post("/:id/pause", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "active") {
      res.status(400).json({ error: `Cannot pause project in '${project.status}' status` });
      return;
    }

    updateProject(id, { status: "paused" });
    addProjectUpdate(id, "info", "Project paused.");

    // Cancel any pending/claimed launch requests for this project so the launcher
    // doesn't spawn new agent terminals after the pause
    const db2 = getDb();
    const cancelled = db2.prepare(`
      UPDATE launch_requests
      SET status = 'failed'
      WHERE status IN ('pending', 'claimed')
        AND agent_id LIKE ?
    `).run(`%"project_id":"${id}"%`);
    if (cancelled.changes > 0) {
      addProjectUpdate(id, "info", `Cancelled ${cancelled.changes} pending launch request(s).`);
    }

    // Notify all active agents in the project so they stand down immediately
    // via their background message watcher (no polling delay needed)
    const pauseNotice =
      "PROJECT PAUSED BY USER: The user has paused this project. " +
      "You must stand down immediately. If you are the PM: close all active sub-agents " +
      `(GET /api/projects/${id}/agents for the list, then POST /api/agents/{id}/close for each active one), ` +
      "post a project timeline update listing what was closed, then go idle and await instructions. " +
      "If you are a sub-agent: stop all work, post a checkin with status=idle, and await instructions. " +
      "Do NOT start any new work or spawn any new agents.";

    const agents = getProjectAgents(id);
    let notified = 0;
    for (const agent of agents) {
      const agentStatus = (agent as Record<string, unknown>).status as string;
      if (!["idle", "archived"].includes(agentStatus)) {
        addMessage((agent as Record<string, unknown>).id as string, pauseNotice, "system");
        notified++;
      }
    }

    if (notified > 0) {
      addProjectUpdate(id, "info", `Pause notice sent to ${notified} active agent(s).`);
    }

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error pausing project");
    res.status(500).json({ error: "Failed to pause project" });
  }
});

// POST /:id/complete — mark project as completed
router.post("/:id/complete", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const db = getDb();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const transaction = db.transaction(() => {
      // Set project to completed
      updateProject(id, { status: "completed", completed_at: now });

      // Archive ALL project agents (PM + sub-agents)
      db.prepare(`
        UPDATE agents SET status = 'archived'
        WHERE project_id = ? AND status IN ('active','working','idle','waiting-for-input')
      `).run(id);

      addProjectUpdate(id, "milestone", "Project completed. All agents archived.");
    });

    transaction();

    const updatedProject = getProject(id);
    broadcast("project-updated", updatedProject);

    // Broadcast updates for any archived agents
    const agents = getProjectAgents(id);
    for (const agent of agents) {
      broadcast("agent-updated", agent);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error completing project");
    res.status(500).json({ error: "Failed to complete project" });
  }
});

// DELETE /:id — delete project and all data
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const db = getDb();
    const transaction = db.transaction(() => {
      // Unlink agents from project (don't delete agents, just clear their project_id)
      db.prepare("UPDATE agents SET project_id = NULL, role = NULL, parent_agent_id = NULL WHERE project_id = ?").run(id);

      // Delete project (cascade deletes project_updates)
      deleteProject(id);
    });

    transaction();

    broadcast("project-deleted", { id });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error deleting project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// GET /:id/files — list all files from all project agents
router.get("/:id/files", (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const agents = getProjectAgents(id);
    const allFiles: Record<string, unknown>[] = [];

    for (const agent of agents) {
      const agentId = (agent as Record<string, unknown>).id as string;
      const agentRole = (agent as Record<string, unknown>).role as string || "Agent";
      const result = getFilesMeta(agentId, 100);
      const files = result.data || [];
      for (const file of files) {
        allFiles.push({ ...file, agent_role: agentRole });
      }
    }

    // Sort by created_at descending
    allFiles.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );

    res.json(allFiles);
  } catch (err) {
    logger.error({ err }, "Error listing project files");
    res.status(500).json({ error: "Failed to list project files" });
  }
});

// POST /:id/spawn-agent — PM spawns a sub-agent
router.post("/:id/spawn-agent", validate(spawnAgentSchema), (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "active") {
      res.status(400).json({ error: `Cannot spawn agents for project in '${project.status}' status` });
      return;
    }

    // PM enforcement: only the PM agent (or direct user/system calls) can spawn sub-agents
    const pmError = enforcePM(req, project);
    if (pmError) {
      res.status(403).json({ error: pmError });
      return;
    }

    const { role: rawRole, prompt, folder_path, effort: requestedEffort, model: requestedModel } = req.body;

    // Normalize role to predefined ID if it matches by ID, displayName, or full definition prefix.
    // IDs are stored in the DB; the full definition is resolved at message injection time.
    const ROLE_PREFIX_LEN = 80;
    const resolvedPredefined = PREDEFINED_ROLES.find((r) => {
      if (r.id === rawRole || r.displayName === rawRole || r.fullDefinition === rawRole) return true;
      if (rawRole && rawRole.length >= ROLE_PREFIX_LEN) {
        return rawRole.trim().slice(0, ROLE_PREFIX_LEN) === r.fullDefinition.trim().slice(0, ROLE_PREFIX_LEN);
      }
      return false;
    });
    const role = resolvedPredefined ? resolvedPredefined.id : rawRole;

    // Check active agent count vs max_concurrent
    const activeCount = getActiveProjectAgentCount(id);
    const maxConcurrent = (project.max_concurrent as number) || 4;
    if (activeCount >= maxConcurrent) {
      res.status(429).json({
        error: `Max concurrent agents reached (${activeCount}/${maxConcurrent}). Suspend a completed agent to free a slot.`,
      });
      return;
    }

    const agentFolderPath = folder_path || (project.folder_path as string) || "";

    // Enforce MAX constraints: PM may request equal or lower effort/model than project max
    const effortOrder = ["low", "medium", "high"];
    const modelOrder = ["haiku", "sonnet", "opus"];

    const maxEffort = (project.agent_effort as string) || "high";
    const maxModel = (project.agent_model as string) || "claude-sonnet-4-6";

    const resolvedEffort = requestedEffort
      ? effortOrder.indexOf(requestedEffort) <= effortOrder.indexOf(maxEffort)
        ? requestedEffort
        : maxEffort
      : maxEffort;

    const resolvedModel = requestedModel
      ? modelOrder.indexOf(requestedModel) <= modelOrder.indexOf(maxModel)
        ? requestedModel
        : maxModel
      : maxModel;

    // Deduplication: reject if an identical spawn was already requested within the last 10s.
    // Prevents double-spawns caused by PM retry-on-slow-response or rapid double-click.
    const db = getDb();
    const recent = db.prepare(
      `SELECT id FROM launch_requests
       WHERE type = 'new'
         AND status IN ('pending', 'claimed')
         AND agent_id LIKE '%"project_id":"' || ? || '"%'
         AND agent_id LIKE '%"role":"' || ? || '"%'
         AND created_at > datetime('now', '-10 seconds')`
    ).get(id, role);
    if (recent) {
      res.status(409).json({ error: `Duplicate spawn: an identical request was already submitted within the last 10 seconds (launch request ${(recent as Record<string, unknown>).id})` });
      return;
    }

    // Create launch request with project metadata
    const launchResult = createLaunchRequest("new", agentFolderPath);
    const launchRequestId = launchResult.id as number;

    const wtWindow = project.name as string;
    db.prepare("UPDATE launch_requests SET agent_id = ?, wt_window = ? WHERE id = ?")
      .run(JSON.stringify({
        project_id: id, role, prompt,
        parent_agent_id: project.pm_agent_id || null,
        effort: resolvedEffort,
        model: resolvedModel,
        wt_window: wtWindow,
      }), wtWindow, launchRequestId);

    addProjectUpdate(id, "info", `Sub-agent spawn requested: ${role} (launch request ID: ${launchRequestId})`);

    broadcast("launch-request-created", { id: launchRequestId, type: "new", folder_path: agentFolderPath, status: "pending" });

    res.json({ ok: true, launch_request_id: launchRequestId });
  } catch (err) {
    logger.error({ err }, "Error spawning agent for project");
    res.status(500).json({ error: "Failed to spawn agent" });
  }
});

export default router;
