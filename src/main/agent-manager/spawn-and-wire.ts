/**
 * Spawn orchestration and error recovery.
 *
 * Coordinates the spawn attempt, initializes tracking on success,
 * and handles the full error-recovery path (event emit, task update,
 * terminal notification, worktree cleanup) on failure.
 */
import type { ActiveAgent, AgentHandle } from './types'
import type { Logger } from '../logger'
import { logError } from '../logger'
import type { AgentRunClaim, RunAgentDeps } from './run-agent'
import { spawnWithTimeout } from './sdk-adapter'
import { initializeAgentTracking } from './agent-initialization'
import { cleanupWorktree } from './worktree'
import { emitAgentEvent, flushAgentEventBatcher } from '../agent-event-mapper'
import { nowIso } from '../../shared/time'
import { TurnTracker } from './turn-tracker'
import { getDefaultCredentialService } from '../services/credential-service'
import { computeMaxTurns, PIPELINE_DISALLOWED_TOOLS } from './turn-budget'

/**
 * Logs a worktree cleanup warning with consistent format.
 */
function logCleanupWarning(
  taskId: string,
  worktreePath: string,
  err: unknown,
  logger: Logger
): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  logger.warn(
    `[agent-manager] Stale worktree for task ${taskId} at ${worktreePath} — manual cleanup needed: ${detail}`
  )
}

/**
 * Handles a spawn failure: runs optional callback, emits error event,
 * updates task to error, triggers terminal handler, cleans up worktree,
 * then re-throws the original error.
 */
export async function handleSpawnFailure(
  err: unknown,
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<never> {
  const { logger, repo, onTaskTerminal, onSpawnFailure } = deps
  try {
    onSpawnFailure?.()
  } catch (cbErr) {
    logger.warn(`[agent-manager] onSpawnFailure hook threw: ${cbErr}`)
  }
  logError(logger, `[agent-manager] spawnAgent failed for task ${task.id}`, err)
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(task.id, {
    type: 'agent:error',
    message: `Spawn failed: ${errMsg}`,
    timestamp: Date.now()
  })
  // Flush buffered events before the status transition so the error event is
  // persisted to SQLite before the task appears as 'error' in the UI.
  flushAgentEventBatcher()
  try {
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: nowIso(),
      notes: `Spawn failed: ${errMsg}`,
      claimed_by: null
    })
  } catch (updateErr) {
    logger.warn(
      `[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`
    )
  }
  await onTaskTerminal(task.id, 'error')
  try {
    await cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      logger
    })
  } catch (cleanupErr) {
    logCleanupWarning(task.id, worktree.worktreePath, cleanupErr, logger)
  }
  throw err
}

/**
 * Phase 2: Spawns the agent and initializes tracking infrastructure.
 * Returns the active agent and turn tracker, or throws on spawn failure.
 */
export async function spawnAndWireAgent(
  task: AgentRunClaim,
  prompt: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  effectiveModel: string,
  deps: RunAgentDeps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onSpawnSuccess } = deps

  // V0.6 — refresh credentials immediately before spawn. The drain-loop
  // precondition caches for 5 minutes; assembleRunContext + validateTaskForRun
  // can spend enough wall time that the cached result is stale by spawn time.
  // Adhoc agents already do this in adhoc-agent.ts; pipeline agents did not.
  const credService = getDefaultCredentialService(logger)
  const credResult = await credService.refreshCredential('claude')
  if (credResult.status !== 'ok') {
    const message = credResult.actionable
      ? `Pre-spawn credential check failed: ${credResult.actionable}`
      : `Pre-spawn credential check failed (${credResult.status})`
    await handleSpawnFailure(new Error(message), task, worktree, repoPath, deps)
    throw new Error(message) // unreachable
  }

  const specForTurnBudget = task.spec ?? task.prompt ?? task.title ?? ''
  const pipelineTuning = {
    maxTurns: computeMaxTurns(specForTurnBudget),
    disallowedTools: PIPELINE_DISALLOWED_TOOLS
  }

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(
      prompt,
      worktree.worktreePath,
      effectiveModel,
      logger,
      task.max_cost_usd ?? undefined,
      pipelineTuning,
      deps.worktreeBase
    )
    try {
      onSpawnSuccess?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
    await handleSpawnFailure(err, task, worktree, repoPath, deps)
    throw err // unreachable — handleSpawnFailure always throws; satisfies TypeScript
  }

  return initializeAgentTracking(
    task,
    handle,
    effectiveModel,
    worktree,
    prompt,
    activeAgents,
    repo,
    logger
  )
}
