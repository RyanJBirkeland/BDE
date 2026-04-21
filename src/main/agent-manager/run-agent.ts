/**
 * Core agent run lifecycle orchestrator.
 *
 * Coordinates validation → spawn → message consumption → finalization.
 * All heavy lifting is delegated to focused sub-modules.
 */
import type { ActiveAgent } from './types'
import type { Logger } from '../logger'
import { classifyExit } from './fast-fail'
import { cleanupWorktree } from './worktree'
import { resolveSuccess, resolveFailure, deleteAgentBranchBeforeRetry } from './completion'
import { getMainRepoPorcelainStatus } from '../lib/main-repo-guards'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { getGhRepo } from '../paths'
import { emitAgentEvent, flushAgentEventBatcher } from '../agent-event-mapper'
import type { TaskDependency } from '../../shared/types'
import { TurnTracker } from './turn-tracker'
import { nowIso } from '../../shared/time'
import { tryEmitPlaygroundEvent } from './playground-handler'
import { capturePartialDiff } from './partial-diff-capture'
import { validateTaskForRun, assembleRunContext } from './prompt-assembly'
import { consumeMessages } from './message-consumer'
import type { ConsumeMessagesResult } from './message-consumer'
import { persistAgentRunTelemetry } from './agent-telemetry'
import { spawnAndWireAgent } from './spawn-and-wire'
import { MAX_TURNS } from './spawn-sdk'
import { sleep } from '../lib/async-utils'
import { NOTES_MAX_LENGTH } from './types'

export type { ConsumeMessagesResult }

export interface AgentRunClaim {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
  notes?: string | null
  playground_enabled?: boolean
  max_runtime_ms?: number | null
  max_cost_usd?: number | null
  model?: string | null
  depends_on?: TaskDependency[] | null
  cross_repo_contract?: string | null
  revision_feedback?: { timestamp: string; feedback: string; attempt: number }[] | null
}

/** Spawn lifecycle and agent process management. */
export interface RunAgentSpawnDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  /**
   * Configured worktree base — used by spawnAgent's cwd allowlist check so
   * pipeline agents that run inside a user-configured worktreeBase aren't
   * rejected by a module-scope snapshot of DEFAULT_CONFIG.
   */
  worktreeBase: string
  /** Optional — called when agent process successfully spawns. */
  onSpawnSuccess?: () => void
  /** Optional — called when spawnAgent throws. */
  onSpawnFailure?: () => void
}

/** Sprint task data access. */
export interface RunAgentDataDeps {
  repo: IAgentTaskRepository
  logger: Logger
}

/** Terminal status notification. */
export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  logger: Logger
}

/**
 * Full dependency bag for runAgent(). Composed via intersection so callers
 * that only consume a sub-set can depend on the narrower interface.
 */
export type RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps

// Re-export functions consumed by external callers and tests
export {
  validateTaskForRun,
  assembleRunContext,
  fetchUpstreamContext,
  readPriorScratchpad
} from './prompt-assembly'
export { consumeMessages } from './message-consumer'

const CLEANUP_RETRY_DELAYS_MS = [100, 500, 2000]

/**
 * Pre-spawn tripwire: logs the porcelain state of both the main repo and the
 * worktree. If the main repo is dirty at this moment, refuses to spawn — the
 * whole point of worktree isolation is that the main repo is NEVER touched
 * by an agent. A dirty main at this boundary means a prior operation leaked.
 */
async function assertPreSpawnRepoState(
  taskId: string,
  repoPath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()

  let mainStatus = ''
  try {
    mainStatus = await getMainRepoPorcelainStatus(repoPath, env)
  } catch (err) {
    logger.warn(`[run-agent] pre-spawn main-repo status check failed for task ${taskId}: ${err}`)
  }
  logger.info(
    `[run-agent] pre-spawn main-repo status: ${mainStatus ? 'non-empty' : 'empty'}${mainStatus ? `\n${mainStatus}` : ''}`
  )

  let worktreeStatus = ''
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      env
    })
    worktreeStatus = stdout.trim()
  } catch (err) {
    logger.warn(`[run-agent] pre-spawn worktree status check failed for task ${taskId}: ${err}`)
  }
  logger.info(
    `[run-agent] pre-spawn worktree status: ${worktreeStatus ? 'non-empty' : 'empty'}${worktreeStatus ? `\n${worktreeStatus}` : ''}`
  )

  if (mainStatus) {
    throw new Error(
      `Main repo dirty at pre-spawn boundary for task ${taskId} — refusing to spawn. Dirty paths:\n${mainStatus}`
    )
  }
}

/**
 * Attempts worktree cleanup up to 4 times (1 initial + 3 retries with backoff).
 * On persistent failure: logs a warning and surfaces the error to the task's
 * `notes` field so the user sees it in the Task Pipeline view.
 *
 * Exported for unit testing.
 */
export async function cleanupWorktreeWithRetry(
  taskId: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  const args = { repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch }
  for (let attempt = 0; attempt < CLEANUP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await cleanupWorktree(args)
      return
    } catch (err) {
      const delayMs = CLEANUP_RETRY_DELAYS_MS[attempt] ?? 1000
      logger.warn(
        `[agent-manager] Worktree cleanup attempt ${attempt + 1} failed for task ${taskId} — retrying in ${delayMs}ms: ${err}`
      )
      await sleep(delayMs)
    }
  }
  // Final attempt — no more retries
  try {
    await cleanupWorktree(args)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.warn(
      `[agent-manager] Stale worktree for task ${taskId} at ${worktree.worktreePath} — manual cleanup needed: ${detail}`
    )
    const note = `Worktree cleanup failed after ${CLEANUP_RETRY_DELAYS_MS.length + 1} attempts: ${detail}. Manual cleanup: git worktree remove --force ${worktree.worktreePath}`
    const truncated =
      note.length > NOTES_MAX_LENGTH ? note.slice(0, NOTES_MAX_LENGTH - 3) + '...' : note
    try {
      repo.updateTask(taskId, { notes: truncated })
    } catch (updateErr) {
      logger.error(
        `[agent-manager] Failed to surface cleanup failure for task ${taskId}: ${updateErr}`
      )
    }
  }
}

/**
 * Classifies the agent exit (fast-fail vs normal) and drives the appropriate
 * task status transition and terminal notification.
 */
async function resolveAgentExit(
  task: AgentRunClaim,
  exitCode: number | undefined,
  lastAgentOutput: string,
  agent: ActiveAgent,
  exitedAt: number,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: IAgentTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  logger: Logger
): Promise<void> {
  const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
  const now = nowIso()

  if (ffResult === 'fast-fail-exhausted') {
    flushAgentEventBatcher()
    try {
      repo.updateTask(task.id, {
        status: 'error',
        failure_reason: 'spawn',
        completed_at: now,
        notes:
          "Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by.",
        claimed_by: null,
        needs_review: true
      })
    } catch (err) {
      logger.error(
        `[agent-manager] Failed to update task ${task.id} after fast-fail exhausted: ${err}`
      )
    }
    await onTaskTerminal(task.id, 'error')
  } else if (ffResult === 'fast-fail-requeue') {
    try {
      repo.updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null
      })
    } catch (err) {
      logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`)
    }
    // Fast-fail-requeue means the next drain tick will recreate the worktree.
    // Proactively delete the agent branch so the new worktree starts from a
    // clean ref rather than inheriting a stale tip from the failed attempt.
    await deleteAgentBranchBeforeRetry(repoPath, worktree.branch, logger)
    // Notify terminal listeners even on requeue so blocked dependents are unblocked.
    // A fast-fail-requeue ends the current agent run — dependents should not remain
    // blocked indefinitely waiting for a run that already ended.
    await onTaskTerminal(task.id, 'queued')
  } else {
    try {
      const ghRepo = getGhRepo(task.repo) ?? task.repo
      await resolveSuccess(
        {
          taskId: task.id,
          worktreePath: worktree.worktreePath,
          title: task.title,
          ghRepo,
          onTaskTerminal,
          agentSummary: lastAgentOutput || null,
          retryCount: task.retry_count ?? 0,
          repo,
          repoPath
        },
        logger
      )
    } catch (err) {
      logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
      // Pass lastAgentOutput so the retry agent knows what failed and doesn't blindly repeat
      const failureNotes = [lastAgentOutput, String(err)].filter(Boolean).join('\n---\n')
      const isTerminal = resolveFailure(
        {
          taskId: task.id,
          retryCount: task.retry_count ?? 0,
          notes: failureNotes || undefined,
          repo
        },
        logger
      )
      if (isTerminal) {
        await onTaskTerminal(task.id, 'failed')
      } else {
        // Non-terminal: task was requeued. Delete the branch so the next drain
        // tick's worktree setup starts from a clean slate.
        await deleteAgentBranchBeforeRetry(repoPath, worktree.branch, logger)
      }
    }
  }
}

/**
 * Preserves the worktree if the task moved to 'review' status;
 * otherwise captures a partial diff and removes the worktree.
 */
async function cleanupOrPreserveWorktree(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  const currentTask = repo.getTask(task.id)
  if (currentTask?.status !== 'review') {
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    await cleanupWorktreeWithRetry(task.id, worktree, repoPath, repo, logger)
  } else {
    logger.info(
      `[agent-manager] Preserving worktree for review task ${task.id} at ${worktree.worktreePath}`
    )
  }
}

/**
 * Phase 3: Finalizes agent run — emits completion event, classifies exit,
 * runs resolution handlers, and cleans up resources.
 */
async function finalizeAgentRun(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  agent: ActiveAgent,
  agentRunId: string,
  turnTracker: TurnTracker,
  exitCode: number | undefined,
  lastAgentOutput: string,
  deps: RunAgentDeps
): Promise<void> {
  const { activeAgents, logger, repo, onTaskTerminal } = deps

  const exitedAt = Date.now()
  const durationMs = exitedAt - agent.startedAt

  // Emit completion event
  emitAgentEvent(agentRunId, {
    type: 'agent:completed',
    exitCode: exitCode ?? 0,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    durationMs,
    timestamp: exitedAt
  })

  // Check if watchdog already cleaned up, or if a retry has already overwritten this entry.
  // Keying by taskId means a retry's set() overwrites the previous run's entry — guard by agentRunId.
  if (activeAgents.get(task.id)?.agentRunId !== agent.agentRunId) {
    logger.info(
      `[agent-manager] Agent ${task.id} (run ${agent.agentRunId}) already cleaned up or superseded by retry`
    )
    // Flush any pending agent events to SQLite before cleanup.
    // The batcher uses a 100ms timer — without this flush, the last
    // batch of events is broadcast to the UI but never persisted.
    flushAgentEventBatcher()
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    await cleanupWorktreeWithRetry(task.id, worktree, repoPath, repo, logger)
    return
  }

  persistAgentRunTelemetry(agentRunId, agent, exitCode, turnTracker, exitedAt, durationMs, logger)
  await resolveAgentExit(
    task,
    exitCode,
    lastAgentOutput,
    agent,
    exitedAt,
    worktree,
    repoPath,
    repo,
    onTaskTerminal,
    logger
  )

  // Remove from active map — guarded: a retry may have already overwritten this entry
  if (activeAgents.get(task.id)?.agentRunId === agent.agentRunId) {
    activeAgents.delete(task.id)
  }

  // Flush events before the next drain tick or cleanup — the 100ms batcher
  // timer is not guaranteed to fire before a new task starts or shutdown.
  flushAgentEventBatcher()

  await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)

  logger.info(
    `[agent-manager] Agent completed for task ${task.id} (exitCode=${exitCode ?? 'none'})`
  )
}

export async function runAgent(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger } = deps
  const effectiveModel = task.model || deps.defaultModel

  // Phase 1: Validate and prepare prompt
  let prompt: string
  try {
    await validateTaskForRun(task, worktree, repoPath, deps)
    prompt = await assembleRunContext(task, worktree, deps)
  } catch {
    return // Early exit — validation failed and cleaned up
  }

  // Pre-spawn tripwire — logs main/worktree porcelain status and fails fast
  // if the main repo is dirty. This is the boundary where an agent-edit leak
  // would first become visible.
  try {
    await assertPreSpawnRepoState(task.id, repoPath, worktree.worktreePath, logger)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`[run-agent] ${errMsg}`)
    try {
      deps.repo.updateTask(task.id, {
        status: 'error',
        completed_at: nowIso(),
        notes: errMsg,
        claimed_by: null
      })
    } catch (updateErr) {
      logger.error(
        `[run-agent] Failed to persist pre-spawn failure for task ${task.id}: ${updateErr}`
      )
    }
    await deps
      .onTaskTerminal(task.id, 'error')
      .catch((terminalErr) =>
        logger.warn(`[run-agent] onTaskTerminal failed for ${task.id}: ${terminalErr}`)
      )
    return
  }

  // Phase 2: Spawn and wire agent
  let agent: ActiveAgent, agentRunId: string, turnTracker: TurnTracker
  try {
    const spawnResult = await spawnAndWireAgent(
      task,
      prompt,
      worktree,
      repoPath,
      effectiveModel,
      deps
    )
    agent = spawnResult.agent
    agentRunId = spawnResult.agentRunId
    turnTracker = spawnResult.turnTracker
  } catch {
    return // Early exit — spawn failed and cleaned up
  }

  // Phase 3: Consume messages
  const { exitCode, lastAgentOutput, streamError, pendingPlaygroundPaths } = await consumeMessages(
    agent.handle,
    agent,
    task,
    agentRunId,
    turnTracker,
    logger,
    MAX_TURNS
  )

  // Await playground events before worktree cleanup.
  // Previously fire-and-forget — worktree could be deleted before file I/O completed.
  for (const playgroundWrite of pendingPlaygroundPaths) {
    await tryEmitPlaygroundEvent(
      task.id,
      playgroundWrite.path,
      worktree.worktreePath,
      logger,
      playgroundWrite.contentType
    ).catch((err) => {
      logger.warn(
        `[run-agent] playground emit failed for task ${task.id}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
      )
    })
  }

  if (streamError) {
    logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
    // agent:error was already emitted in consumeMessages' catch block with "Stream interrupted:" prefix.
    // Don't emit a second event here — UI would show the error twice.
    // exitCode will be undefined; finalizeAgentRun's classifyExit treats undefined as exit code 1
  }

  // Phase 4: Finalize — classify exit, resolve, cleanup
  await finalizeAgentRun(
    task,
    worktree,
    repoPath,
    agent,
    agentRunId,
    turnTracker,
    exitCode,
    lastAgentOutput,
    deps
  )
}
