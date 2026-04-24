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
import type { IUnitOfWork } from '../data/unit-of-work'
import type { MetricsCollector } from './metrics'
import { FAST_FAIL_EXHAUSTED_NOTE } from './failure-messages'
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
import { computeMaxTurns } from './turn-budget'
import { sleep } from '../lib/async-utils'
import { NOTES_MAX_LENGTH } from './types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { extractFilesToChange } from './spec-parser'

export type { ConsumeMessagesResult }

export interface AgentRunClaim {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  spec_type?: string | null
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
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
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
  /**
   * Optional — called immediately after the agent is registered in activeAgents.
   * Used by AgentManagerImpl to decrement _pendingSpawns once the agent has
   * entered activeAgents so each running agent is counted exactly once.
   */
  onAgentRegistered?: () => void
}

/** Sprint task data access. */
export interface RunAgentDataDeps {
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  logger: Logger
  metrics: MetricsCollector
}

/** Terminal status notification. */
export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
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
  if (await tryCleanupWithBackoff(taskId, args, logger)) return
  await runFinalCleanupAttempt(taskId, args, worktree.worktreePath, repo, logger)
}

async function tryCleanupWithBackoff(
  taskId: string,
  args: { repoPath: string; worktreePath: string; branch: string },
  logger: Logger
): Promise<boolean> {
  for (let attempt = 0; attempt < CLEANUP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await cleanupWorktree(args)
      return true
    } catch (err) {
      const delayMs = CLEANUP_RETRY_DELAYS_MS[attempt] ?? 1000
      logger.warn(
        `[agent-manager] Worktree cleanup attempt ${attempt + 1} failed for task ${taskId} — retrying in ${delayMs}ms: ${err}`
      )
      await sleep(delayMs)
    }
  }
  return false
}

async function runFinalCleanupAttempt(
  taskId: string,
  args: { repoPath: string; worktreePath: string; branch: string },
  worktreePath: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  try {
    await cleanupWorktree(args)
  } catch (err) {
    surfaceCleanupFailureToTaskNotes(taskId, worktreePath, err, repo, logger)
  }
}

function surfaceCleanupFailureToTaskNotes(
  taskId: string,
  worktreePath: string,
  err: unknown,
  repo: IAgentTaskRepository,
  logger: Logger
): void {
  const detail = err instanceof Error ? err.message : String(err)
  logger.warn(
    `[agent-manager] Stale worktree for task ${taskId} at ${worktreePath} — manual cleanup needed: ${detail}`
  )
  const note = `Worktree cleanup failed after ${CLEANUP_RETRY_DELAYS_MS.length + 1} attempts: ${detail}. Manual cleanup: git worktree remove --force ${worktreePath}`
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

/**
 * Classifies the agent exit (fast-fail vs normal) and drives the appropriate
 * task status transition and terminal notification.
 */
interface ResolveAgentExitContext {
  task: AgentRunClaim
  exitCode: number | undefined
  lastAgentOutput: string
  agent: ActiveAgent
  exitedAt: number
  worktree: { worktreePath: string; branch: string }
  repoPath: string
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  logger: Logger
}

async function resolveAgentExit(ctx: ResolveAgentExitContext): Promise<void> {
  const ffResult = classifyExit(
    ctx.agent.startedAt,
    ctx.exitedAt,
    ctx.exitCode ?? 1,
    ctx.task.fast_fail_count ?? 0
  )
  if (ffResult === 'fast-fail-exhausted') return handleFastFailExhausted(ctx)
  if (ffResult === 'fast-fail-requeue') return handleFastFailRequeue(ctx)
  return resolveNormalExit(ctx)
}

async function handleFastFailExhausted(ctx: ResolveAgentExitContext): Promise<void> {
  flushAgentEventBatcher()
  try {
    ctx.repo.updateTask(ctx.task.id, {
      status: 'error',
      failure_reason: 'spawn',
      completed_at: nowIso(),
      notes: FAST_FAIL_EXHAUSTED_NOTE,
      claimed_by: null,
      needs_review: true
    })
  } catch (err) {
    ctx.logger.error(
      `[agent-manager] Failed to update task ${ctx.task.id} after fast-fail exhausted: ${err}`
    )
  }
  await ctx.onTaskTerminal(ctx.task.id, 'error')
}

async function handleFastFailRequeue(ctx: ResolveAgentExitContext): Promise<void> {
  try {
    ctx.repo.updateTask(ctx.task.id, {
      status: 'queued',
      fast_fail_count: (ctx.task.fast_fail_count ?? 0) + 1,
      claimed_by: null
    })
  } catch (err) {
    ctx.logger.error(`[agent-manager] Failed to requeue fast-fail task ${ctx.task.id}: ${err}`)
  }
  // Fast-fail-requeue means the next drain tick will recreate the worktree.
  // Delete the agent branch so the new worktree starts from a clean ref.
  await deleteAgentBranchBeforeRetry(ctx.repoPath, ctx.worktree.branch, ctx.logger)
  // Notify terminal listeners even on requeue so blocked dependents unblock —
  // this run ended, even if a retry will follow.
  await ctx.onTaskTerminal(ctx.task.id, 'queued')
}

/**
 * Checks that all files listed in the spec's `## Files to Change` section
 * appear in the agent's commit diff.
 *
 * Returns `null` when no checklist is present (prompt-type tasks, missing
 * section) — the caller should continue normally.
 *
 * Returns a non-empty array of missing paths when the commit diff is
 * incomplete. The caller must re-queue the task with a note listing them.
 */
async function detectMissingSpecFiles(
  task: AgentRunClaim,
  worktreePath: string,
  logger: Logger
): Promise<string[] | null> {
  if (task.spec_type === 'prompt' || !task.spec) return null

  const requiredFiles = extractFilesToChange(task.spec)
  if (requiredFiles.length === 0) return null

  let diffOutput: string
  try {
    const env = buildAgentEnv()
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'main..HEAD'], {
      cwd: worktreePath,
      env
    })
    diffOutput = stdout
  } catch (err) {
    // If the diff command fails (e.g. no commits yet), let the existing
    // commit-check guard handle it rather than re-queuing here.
    logger.warn(`[run-agent] git diff failed during files-checklist check: ${err}`)
    return null
  }

  const changedFiles = new Set(
    diffOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  )

  const missingFiles = requiredFiles.filter((required) => !changedFiles.has(required))
  return missingFiles.length > 0 ? missingFiles : null
}

/**
 * Re-queues the task with a note listing the spec files the agent missed.
 * The retry agent will see the exact missing paths in its context.
 */
async function handleIncompleteFiles(
  ctx: ResolveAgentExitContext,
  missingFiles: string[]
): Promise<void> {
  const notes = `Files to Change checklist incomplete. Missing: ${missingFiles.join(', ')}`
  ctx.logger.warn(`[run-agent] task ${ctx.task.id}: ${notes}`)

  const isTerminal = resolveFailure(
    {
      taskId: ctx.task.id,
      retryCount: ctx.task.retry_count ?? 0,
      notes,
      repo: ctx.repo
    },
    ctx.logger
  )
  if (isTerminal) {
    await ctx.onTaskTerminal(ctx.task.id, 'failed')
    return
  }
  await deleteAgentBranchBeforeRetry(ctx.repoPath, ctx.worktree.branch, ctx.logger)
}

async function resolveNormalExit(ctx: ResolveAgentExitContext): Promise<void> {
  const missingFiles = await detectMissingSpecFiles(
    ctx.task,
    ctx.worktree.worktreePath,
    ctx.logger
  )
  if (missingFiles !== null) {
    return handleIncompleteFiles(ctx, missingFiles)
  }

  try {
    const ghRepo = getGhRepo(ctx.task.repo) ?? ctx.task.repo
    await resolveSuccess(
      {
        taskId: ctx.task.id,
        worktreePath: ctx.worktree.worktreePath,
        title: ctx.task.title,
        ghRepo,
        onTaskTerminal: ctx.onTaskTerminal,
        agentSummary: ctx.lastAgentOutput || null,
        retryCount: ctx.task.retry_count ?? 0,
        repo: ctx.repo,
        unitOfWork: ctx.unitOfWork,
        repoPath: ctx.repoPath
      },
      ctx.logger
    )
  } catch (err) {
    await handleResolveSuccessFailure(ctx, err)
  }
}

async function handleResolveSuccessFailure(
  ctx: ResolveAgentExitContext,
  err: unknown
): Promise<void> {
  ctx.logger.warn(`[agent-manager] resolveSuccess failed for task ${ctx.task.id}: ${err}`)
  // Pass lastAgentOutput so the retry agent knows what failed and doesn't repeat blindly.
  const failureNotes = [ctx.lastAgentOutput, String(err)].filter(Boolean).join('\n---\n')
  const isTerminal = resolveFailure(
    {
      taskId: ctx.task.id,
      retryCount: ctx.task.retry_count ?? 0,
      notes: failureNotes || undefined,
      repo: ctx.repo
    },
    ctx.logger
  )
  if (isTerminal) {
    await ctx.onTaskTerminal(ctx.task.id, 'failed')
    return
  }
  // Non-terminal: task was requeued. Delete the branch so the next drain
  // tick's worktree setup starts from a clean slate.
  await deleteAgentBranchBeforeRetry(ctx.repoPath, ctx.worktree.branch, ctx.logger)
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
  const exitedAt = Date.now()
  const durationMs = exitedAt - agent.startedAt

  emitCompletionEvent(agentRunId, agent, exitCode, exitedAt, durationMs)
  deps.metrics.recordAgentDuration(durationMs)

  if (await handleSupersededRun(task, worktree, repoPath, agent, deps)) return

  persistAgentRunTelemetry(
    agentRunId,
    agent,
    exitCode,
    turnTracker,
    exitedAt,
    durationMs,
    deps.logger
  )
  await resolveAgentExit({
    task,
    exitCode,
    lastAgentOutput,
    agent,
    exitedAt,
    worktree,
    repoPath,
    repo: deps.repo,
    unitOfWork: deps.unitOfWork,
    onTaskTerminal: deps.onTaskTerminal,
    logger: deps.logger
  })

  await persistAndCleanupAfterRun(task, worktree, repoPath, agent, deps)
  deps.logger.info(
    `[agent-manager] Agent completed for task ${task.id} (exitCode=${exitCode ?? 'none'})`
  )
}

function emitCompletionEvent(
  agentRunId: string,
  agent: ActiveAgent,
  exitCode: number | undefined,
  exitedAt: number,
  durationMs: number
): void {
  emitAgentEvent(agentRunId, {
    type: 'agent:completed',
    exitCode: exitCode ?? 0,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    durationMs,
    timestamp: exitedAt
  })
}

/**
 * Detect whether the watchdog already removed this agent or a retry has
 * overwritten the active-agents entry. When superseded, performs the
 * minimal-but-correct cleanup (flush events, capture partial diff, remove
 * worktree) and returns true so the caller short-circuits.
 */
async function handleSupersededRun(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  agent: ActiveAgent,
  deps: RunAgentDeps
): Promise<boolean> {
  if (deps.activeAgents.get(task.id)?.agentRunId === agent.agentRunId) return false
  deps.logger.info(
    `[agent-manager] Agent ${task.id} (run ${agent.agentRunId}) already cleaned up or superseded by retry`
  )
  // The batcher uses a 100ms timer — without this flush, the last batch of
  // events would be broadcast to the UI but never persisted to SQLite.
  flushAgentEventBatcher()
  await capturePartialDiff(task.id, worktree.worktreePath, deps.repo, deps.logger)
  await cleanupWorktreeWithRetry(task.id, worktree, repoPath, deps.repo, deps.logger)
  return true
}

async function persistAndCleanupAfterRun(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  agent: ActiveAgent,
  deps: RunAgentDeps
): Promise<void> {
  // Remove from active map — guarded: a retry may have already overwritten this entry.
  if (deps.activeAgents.get(task.id)?.agentRunId === agent.agentRunId) {
    deps.activeAgents.delete(task.id)
  }
  // Flush events before the next drain tick or cleanup — the 100ms batcher
  // timer is not guaranteed to fire before a new task starts or shutdown.
  flushAgentEventBatcher()
  await cleanupOrPreserveWorktree(task, worktree, repoPath, deps.repo, deps.logger)
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
    computeMaxTurns(task.spec ?? task.prompt ?? task.title ?? '')
  )

  // Await playground events before worktree cleanup.
  // Previously fire-and-forget — worktree could be deleted before file I/O completed.
  for (const playgroundWrite of pendingPlaygroundPaths) {
    await tryEmitPlaygroundEvent({
      taskId: task.id,
      filePath: playgroundWrite.path,
      worktreePath: worktree.worktreePath,
      logger,
      contentType: playgroundWrite.contentType
    }).catch((err) => {
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
