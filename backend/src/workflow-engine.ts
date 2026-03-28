import { getDb, getAgent, createLaunchRequest } from "./db.js";
import { logger } from "./logger.js";

export interface WorkflowStep {
  name: string;
  folder_path: string;
  prompt: string;
  trigger: "on_complete";
  condition: string | null;
  agent_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface Workflow {
  id: string;
  name: string;
  steps: string; // JSON string of WorkflowStep[]
  status: "pending" | "running" | "completed" | "failed" | "paused";
  current_step: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string; // JSON string
}

export function initWorkflowEngine(): void {
  logger.info("Workflow engine initialized");
}

/**
 * Called when an agent's status changes. Checks if any running workflow
 * has a step assigned to this agent and advances accordingly.
 */
export function onAgentStatusChange(agentId: string, newStatus: string): void {
  const db = getDb();

  // Find running workflows that reference this agent in their current step
  const workflows = db
    .prepare("SELECT * FROM workflows WHERE status = 'running'")
    .all() as Workflow[];

  for (const wf of workflows) {
    let steps: WorkflowStep[];
    try {
      steps = JSON.parse(wf.steps);
    } catch {
      continue;
    }

    const currentStep = steps[wf.current_step];
    if (!currentStep || currentStep.agent_id !== agentId) continue;

    if (newStatus === "completed") {
      // Check condition if present
      if (currentStep.condition) {
        const agent = getAgent(agentId);
        const latestSummary = agent?.latest_summary as string | undefined;
        if (!latestSummary || !latestSummary.includes(currentStep.condition)) {
          logger.info(
            { workflowId: wf.id, step: wf.current_step, condition: currentStep.condition },
            "Workflow step condition not met, marking step failed"
          );
          currentStep.status = "failed";
          updateWorkflowSteps(wf.id, steps);
          db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(wf.id);
          continue;
        }
      }

      // Mark current step completed and advance
      currentStep.status = "completed";
      updateWorkflowSteps(wf.id, steps);
      advanceWorkflow(wf.id);
    } else if (newStatus === "archived" && currentStep.status === "running") {
      // Agent was archived while running — treat as failure
      currentStep.status = "failed";
      updateWorkflowSteps(wf.id, steps);
      db.prepare(
        "UPDATE workflows SET status = 'failed', completed_at = datetime('now') WHERE id = ?"
      ).run(wf.id);
      logger.warn({ workflowId: wf.id, agentId }, "Workflow failed: agent archived during step execution");
    }
  }
}

export function advanceWorkflow(workflowId: string): void {
  const db = getDb();
  const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as Workflow | undefined;
  if (!wf || wf.status !== "running") return;

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(wf.steps);
  } catch {
    return;
  }

  const nextIdx = wf.current_step + 1;

  // All steps completed
  if (nextIdx >= steps.length) {
    db.prepare(
      "UPDATE workflows SET status = 'completed', completed_at = datetime('now'), current_step = ? WHERE id = ?"
    ).run(nextIdx, workflowId);
    logger.info({ workflowId }, "Workflow completed");
    return;
  }

  // Launch next step
  const nextStep = steps[nextIdx];
  nextStep.status = "running";

  // Create a launch request for the new agent
  const launchResult = createLaunchRequest("new", nextStep.folder_path);
  logger.info(
    { workflowId, stepIndex: nextIdx, launchRequestId: launchResult.id },
    "Workflow advancing to step: %s",
    nextStep.name
  );

  // Update workflow state
  updateWorkflowSteps(workflowId, steps);
  db.prepare("UPDATE workflows SET current_step = ? WHERE id = ?").run(nextIdx, workflowId);
}

export function startWorkflow(workflowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as Workflow | undefined;
  if (!wf) return { ok: false, error: "Workflow not found" };
  if (wf.status === "running") return { ok: false, error: "Workflow already running" };
  if (wf.status === "completed") return { ok: false, error: "Workflow already completed" };

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(wf.steps);
  } catch {
    return { ok: false, error: "Invalid steps JSON" };
  }

  if (steps.length === 0) return { ok: false, error: "Workflow has no steps" };

  // Start from current_step (allows resuming paused workflows)
  const startIdx = wf.current_step;
  if (startIdx >= steps.length) return { ok: false, error: "All steps already processed" };

  const step = steps[startIdx];
  step.status = "running";

  // Create launch request for the first step
  const launchResult = createLaunchRequest("new", step.folder_path);

  updateWorkflowSteps(workflowId, steps);
  db.prepare(
    "UPDATE workflows SET status = 'running', started_at = datetime('now'), current_step = ? WHERE id = ?"
  ).run(startIdx, workflowId);

  logger.info(
    { workflowId, stepIndex: startIdx, launchRequestId: launchResult.id },
    "Workflow started at step: %s",
    step.name
  );

  return { ok: true };
}

export function pauseWorkflow(workflowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as Workflow | undefined;
  if (!wf) return { ok: false, error: "Workflow not found" };
  if (wf.status !== "running") return { ok: false, error: "Workflow is not running" };

  db.prepare("UPDATE workflows SET status = 'paused' WHERE id = ?").run(workflowId);
  logger.info({ workflowId }, "Workflow paused");
  return { ok: true };
}

/**
 * Associate an agent ID with the current running step of a workflow.
 * Called when a launched agent registers itself.
 */
export function assignAgentToWorkflowStep(workflowId: string, agentId: string): void {
  const db = getDb();
  const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as Workflow | undefined;
  if (!wf) return;

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(wf.steps);
  } catch {
    return;
  }

  const step = steps[wf.current_step];
  if (step) {
    step.agent_id = agentId;
    updateWorkflowSteps(wf.id, steps);
  }
}

function updateWorkflowSteps(workflowId: string, steps: WorkflowStep[]): void {
  const db = getDb();
  db.prepare("UPDATE workflows SET steps = ? WHERE id = ?").run(JSON.stringify(steps), workflowId);
}
