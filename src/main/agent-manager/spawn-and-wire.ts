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
import { getRepoEnvVars } from '../paths'
import { PIPELINE_DISALLOWED_TOOLS } from './turn-budget'
import { PipelineAbortError } from './pipeline-abort-error'

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
 * transitions task to error via TaskStateService (which fires onTaskTerminal
 * internally), cleans up worktree, then re-throws the original error.
 */
export async function handleSpawnFailure(
  err: unknown,
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<never> {
  const { logger, onSpawnFailure, taskStateService } = deps
  const errReason = err instanceof Error ? err.message : String(err)
  try {
    onSpawnFailure?.(task.id, errReason)
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
    await taskStateService.transition(task.id, 'error', {
      fields: { completed_at: nowIso(), notes: `Spawn failed: ${errMsg}`, claimed_by: null },
      caller: 'spawn-failure'
    })
  } catch (transitionErr) {
    logger.warn(
      `[agent-manager] Failed to transition task ${task.id} to error after spawn failure: ${transitionErr}`
    )
  }
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
  throw new PipelineAbortError('Spawn failed and recovered', err)
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
  const { spawnRegistry, logger, repo, onSpawnSuccess } = deps

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

  const pipelineTuning = {
    maxTurns: deps.maxTurns,
    disallowedTools: PIPELINE_DISALLOWED_TOOLS
  }

  const extraEnv = getRepoEnvVars(task.repo)

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout({
      prompt,
      cwd: worktree.worktreePath,
      model: effectiveModel,
      logger,
      ...(task.max_cost_usd != null && { maxBudgetUsd: task.max_cost_usd }),
      pipelineTuning,
      worktreeBase: deps.worktreeBase,
      branch: worktree.branch,
      ...(deps.tickId != null && { tickId: deps.tickId }),
      // epicGroupService — not used by pipeline agents here
      worktreePath: worktree.worktreePath,
      extraEnv,
      ...(deps.resolveMainRepoPaths && { mainRepoPaths: deps.resolveMainRepoPaths() })
    })
    try {
      onSpawnSuccess?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
    await handleSpawnFailure(err, task, worktree, repoPath, deps)
    throw err // unreachable — handleSpawnFailure throws PipelineAbortError; satisfies TypeScript
  }

  const result = initializeAgentTracking(
    task,
    handle,
    effectiveModel,
    worktree,
    prompt,
    spawnRegistry,
    repo,
    logger
  )
  try {
    deps.onAgentRegistered?.()
  } catch (cbErr) {
    logger.warn(`[agent-manager] onAgentRegistered hook threw: ${cbErr}`)
  }
  return result
}
