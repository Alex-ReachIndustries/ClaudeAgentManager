import { detectDeadAgents, setAgentRecovering, setAgentFailed, createLaunchRequest, addUpdate, getAgent } from "./db.js";
import { broadcast } from "./sse.js";
import { logger } from "./logger.js";

const DEAD_AGENT_THRESHOLD_MINUTES = 5;
const RECOVERY_CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

export function recoverDeadAgents(): { recovered: string[]; failed: string[] } {
  const recovered: string[] = [];
  const failed: string[] = [];

  const deadAgents = detectDeadAgents(DEAD_AGENT_THRESHOLD_MINUTES);

  for (const agent of deadAgents) {
    const id = agent.id as string;
    const recoveryCount = (agent.recovery_count as number) ?? 0;
    const maxAttempts = (agent.max_recovery_attempts as number) ?? 3;

    if (recoveryCount >= maxAttempts) {
      // Max recovery attempts exceeded — mark as failed
      setAgentFailed(id);
      addUpdate(id, "error", `Auto-recovery failed: exceeded max attempts (${maxAttempts}). Agent marked as failed.`, "Recovery failed — max attempts exceeded");
      const updatedAgent = getAgent(id);
      if (updatedAgent) broadcast("agent-updated", updatedAgent);
      logger.warn({ agentId: id, recoveryCount, maxAttempts }, "Agent recovery failed: max attempts exceeded");
      failed.push(id);
      continue;
    }

    // Set status to recovering and increment count
    setAgentRecovering(id);

    // Create resume launch request
    const folderPath = (agent.cwd as string) || "";
    const launchRequest = createLaunchRequest("resume", folderPath, id);
    broadcast("launch-request-created", launchRequest);

    // Post a visible update
    addUpdate(id, "status", `Auto-recovery triggered (attempt ${recoveryCount + 1}/${maxAttempts}). Creating resume launch request.`, `Auto-recovering (attempt ${recoveryCount + 1}/${maxAttempts})`);

    const updatedAgent = getAgent(id);
    if (updatedAgent) broadcast("agent-updated", updatedAgent);

    logger.info({ agentId: id, attempt: recoveryCount + 1, maxAttempts, launchRequestId: (launchRequest as Record<string, unknown>).id }, "Auto-recovery: resume launch request created");
    recovered.push(id);
  }

  return { recovered, failed };
}

export function startRecoveryScheduler(): void {
  logger.info(`Recovery scheduler started (checks every ${RECOVERY_CHECK_INTERVAL_MS / 1000}s for dead agents, threshold: ${DEAD_AGENT_THRESHOLD_MINUTES}min)`);

  setInterval(() => {
    try {
      const { recovered, failed } = recoverDeadAgents();
      if (recovered.length > 0 || failed.length > 0) {
        logger.info({ recovered: recovered.length, failed: failed.length }, "Recovery sweep complete");
      }
    } catch (err) {
      logger.error({ err }, "Error in recovery sweep");
    }
  }, RECOVERY_CHECK_INTERVAL_MS);
}
