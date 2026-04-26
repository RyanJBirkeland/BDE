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
import type { TaskStateService } from '../services/task-state-service'
import { PipelineAbortError } from './pipeline-abort-error'

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
  /**
   * Optional — called when spawnAgent throws (spawn phase only, before the
   * SDK stream starts). Receives the task ID and error reason so callers can
   * scope circuit-breaker accounting to spawn-phase failures exclusively.
   */
  onSpawnFailure?: (taskId: string, reason: string) => void
  /**
   * Optional — called immediately after the agent is registered in activeAgents.
   * Used by AgentManagerImpl to decrement _pendingSpawns once the agent has
   * entered activeAgents so each running agent is counted exactly once.
   */
  onAgentRegistered?: () => void
  /** Drain-tick correlation ID — threads from DrainLoopDeps to the spawn log. */
  tickId?: string | undefined
  /**
   * Called with the in-flight Keychain refresh promise when an auth error
   * triggers `handleOAuthRefresh`. The drain loop awaits this via
   * `AgentManager.awaitOAuthRefresh` before the next spawn.
   */
  onOAuthRefreshStart?: (promise: Promise<unknown>) => void
}

/** Sprint task data access and status transition service. */
export interface RunAgentDataDeps {
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  logger: Logger
  metrics: MetricsCollector
  taskStateService: TaskStateService
}

/** Terminal status notification. */
export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  logger: Logger
}

/**
 * Fast-fail sliding-window callbacks threaded into runAgent so the in-memory
 * tracker in ErrorRegistry can be updated without coupling run-agent.ts
 * directly to AgentManagerImpl.
 *
 * Both are optional so callers that don't need the sliding window (e.g. tests)
 * don't have to supply them — the fallback is the legacy DB-count behaviour.
 */
export interface RunAgentFastFailDeps {
  /**
   * Record a fast-fail event in the sliding window for the given task.
   * Called when a run qualifies as a fast-fail (exit within 30s, non-zero
   * exit code) before the exhaustion check.
   */
  onFastFailRecorded?: (taskId: string, reason: string) => void
  /**
   * Returns true if the task has exhausted its fast-fail budget within the
   * 30-second sliding window. When supplied, this supersedes the DB-backed
   * `fast_fail_count` exhaustion check.
   */
  isFastFailExhausted?: (taskId: string) => boolean
}

/**
 * Full dependency bag for runAgent(). Composed via intersection so callers
 * that only consume a sub-set can depend on the narrower interface.
 */
export type RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps & RunAgentFastFailDeps

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
  // fire-and-forget: best-effort note update for stale-worktree diagnostic
  try {
    void Promise.resolve(repo.updateTask(taskId, { notes: truncated })).catch((updateErr) => {
      logger.error(
        `[agent-manager] Failed to surface cleanup failure for task ${taskId}: ${updateErr}`
      )
    })
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
  taskStateService: TaskStateService
  logger: Logger
  onFastFailRecorded?: (taskId: string, reason: string) => void
  isFastFailExhausted?: (taskId: string) => boolean
}

async function resolveAgentExit(ctx: ResolveAgentExitContext): Promise<void> {
  const legacyFastFailCount = ctx.task.fast_fail_count ?? 0
  const ffResult = classifyExit(
    ctx.agent.startedAt,
    ctx.exitedAt,
    ctx.exitCode ?? 1,
    legacyFastFailCount
  )
  // classifyExit returns 'normal-exit' for exit code 0 or long-running runs.
  // Only proceed with fast-fail logic when the run itself qualified as fast.
  if (ffResult === 'normal-exit') return resolveNormalExit(ctx)

  // Fast-fail candidate: record the event in the sliding window, then check
  // whether the task has exceeded the budget within the 30-second window.
  // Falls back to the DB-backed count when no sliding-window callbacks are
  // injected (e.g. tests or callers that don't wire ErrorRegistry).
  const reason = ctx.lastAgentOutput || `exit code ${ctx.exitCode ?? 1}`
  ctx.onFastFailRecorded?.(ctx.task.id, reason)

  const exhausted = ctx.isFastFailExhausted
    ? ctx.isFastFailExhausted(ctx.task.id)
    : ffResult === 'fast-fail-exhausted'

  if (exhausted) return handleFastFailExhausted(ctx)
  return handleFastFailRequeue(ctx)
}

async function handleFastFailExhausted(ctx: ResolveAgentExitContext): Promise<void> {
  flushAgentEventBatcher()
  try {
    await ctx.taskStateService.transition(ctx.task.id, 'error', {
      fields: {
        failure_reason: 'spawn',
        completed_at: nowIso(),
        notes: FAST_FAIL_EXHAUSTED_NOTE,
        claimed_by: null,
        needs_review: true
      },
      caller: 'run-agent:fast-fail-exhausted'
    })
  } catch (err) {
    ctx.logger.error(
      `[agent-manager] Failed to transition task ${ctx.task.id} after fast-fail exhausted: ${err}`
    )
  }
}

async function handleFastFailRequeue(ctx: ResolveAgentExitContext): Promise<void> {
  try {
    await ctx.taskStateService.transition(ctx.task.id, 'queued', {
      fields: {
        fast_fail_count: (ctx.task.fast_fail_count ?? 0) + 1,
        claimed_by: null
      },
      caller: 'run-agent:fast-fail-requeue'
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

  const result = await resolveFailure(
    {
      taskId: ctx.task.id,
      retryCount: ctx.task.retry_count ?? 0,
      notes,
      repo: ctx.repo
    },
    ctx.logger
  )
  if (result.writeFailed) {
    ctx.logger.warn(
      `[run-agent] task ${ctx.task.id}: incomplete-files failure DB write failed — skipping terminal notification`
    )
    return
  }
  if (result.isTerminal) {
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
        repoPath: ctx.repoPath,
        taskStateService: ctx.taskStateService
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
  const result = await resolveFailure(
    {
      taskId: ctx.task.id,
      retryCount: ctx.task.retry_count ?? 0,
      notes: failureNotes || undefined,
      repo: ctx.repo
    },
    ctx.logger
  )
  if (result.writeFailed) {
    ctx.logger.warn(
      `[run-agent] task ${ctx.task.id}: resolve-success failure DB write failed — skipping terminal notification`
    )
    return
  }
  if (result.isTerminal) {
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
 *
 * Defaults to preserve when the DB read fails or returns null — deleting a
 * worktree mid-review is irreversible, whereas a stale worktree is recoverable.
 *
 * Exported for unit testing.
 */
export async function cleanupOrPreserveWorktree(
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  let currentTask: ReturnType<typeof repo.getTask>
  try {
    currentTask = repo.getTask(task.id)
  } catch (err) {
    logger.warn(`[run-agent] could not read task status for ${task.id}, preserving worktree: ${err}`)
    return
  }

  if (currentTask == null) {
    logger.warn(`[run-agent] task ${task.id} not found in DB, preserving worktree`)
    return
  }

  if (currentTask.status !== 'review') {
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
    taskStateService: deps.taskStateService,
    logger: deps.logger,
    ...(deps.onFastFailRecorded && { onFastFailRecorded: deps.onFastFailRecorded }),
    ...(deps.isFastFailExhausted && { isFastFailExhausted: deps.isFastFailExhausted })
  })

  await persistAndCleanupAfterRun(task, worktree, repoPath, agent, deps)
  deps.logger.event('agent.completed', {
    taskId: task.id,
    status: 'review',
    durationMs,
    model: agent.model || 'unknown',
    costUsd: agent.costUsd ?? null
  })
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

/**
 * Best-effort recovery for an unexpected (non-PipelineAbortError) exception
 * escaping Phase 1 or Phase 2.
 *
 * Releases the claim and fires the terminal notification so the task is never
 * left `active` with `claimed_by` set. Both steps are wrapped individually —
 * a secondary DB failure is logged but never re-thrown.
 */
async function abortPhaseUnexpectedly(
  taskId: string,
  phase: string,
  err: unknown,
  deps: Pick<RunAgentDeps, 'repo' | 'onTaskTerminal' | 'logger' | 'taskStateService'>
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  deps.logger.error(`[run-agent] ${phase} aborted unexpectedly for ${taskId}: ${message}`)

  try {
    await deps.taskStateService.transition(taskId, 'error', {
      fields: { claimed_by: null },
      caller: `run-agent.${phase}.unexpected-abort`
    })
  } catch (updateErr) {
    deps.logger.warn(`[run-agent] failed to release claim for ${taskId} after ${phase} abort: ${updateErr}`)
  }
}

/** Result produced by the streaming phase — passed to the completion phase. */
interface StreamResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError: Error | undefined
}

/** Context for the streaming phase — all data produced by setup and spawn. */
interface StreamingContext {
  task: AgentRunClaim
  agent: ActiveAgent
  agentRunId: string
  turnTracker: TurnTracker
  worktree: { worktreePath: string; branch: string }
  deps: RunAgentDeps
}

/**
 * Phase 3: Consume the SDK message stream, await playground file events,
 * and log any stream error.
 *
 * Returns a `StreamResult` containing the exit code and the last agent output
 * so the completion phase can classify and finalize the run.
 */
async function runStreamingPhase(ctx: StreamingContext): Promise<StreamResult> {
  const { task, agent, agentRunId, turnTracker, worktree, deps } = ctx
  const { logger } = deps

  const { exitCode, lastAgentOutput, streamError, pendingPlaygroundPaths } = await consumeMessages(
    agent.handle,
    agent,
    task,
    agentRunId,
    turnTracker,
    logger,
    computeMaxTurns(task.spec ?? task.prompt ?? task.title ?? ''),
    deps.onOAuthRefreshStart
  )

  // Await playground events before worktree cleanup so the worktree isn't
  // removed before file I/O from playground writes completes.
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

  return { exitCode, lastAgentOutput, streamError }
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
  } catch (err) {
    if (err instanceof PipelineAbortError) return // Helper already recovered — no double cleanup
    await abortPhaseUnexpectedly(task.id, 'phase 1', err, deps)
    return
  }

  // Pre-spawn tripwire — logs main/worktree porcelain status and fails fast
  // if the main repo is dirty. This is the boundary where an agent-edit leak
  // would first become visible.
  try {
    await assertPreSpawnRepoState(task.id, repoPath, worktree.worktreePath, logger)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`[run-agent] ${errMsg}`)
    await deps.taskStateService
      .transition(task.id, 'error', {
        fields: { completed_at: nowIso(), notes: errMsg, claimed_by: null },
        caller: 'run-agent:pre-spawn-failure'
      })
      .catch((terminalErr) =>
        logger.warn(`[run-agent] pre-spawn transition failed for ${task.id}: ${terminalErr}`)
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
  } catch (err) {
    if (err instanceof PipelineAbortError) return // Helper already recovered — no double cleanup
    await abortPhaseUnexpectedly(task.id, 'phase 2', err, deps)
    return
  }

  const streamingCtx: StreamingContext = { task, agent, agentRunId, turnTracker, worktree, deps }

  // Phase 3: Consume the SDK message stream and await playground events
  const streamResult = await runStreamingPhase(streamingCtx)

  // Phase 4: Classify exit, resolve status, clean up
  await finalizeAgentRun(
    task,
    worktree,
    repoPath,
    agent,
    agentRunId,
    turnTracker,
    streamResult.exitCode,
    streamResult.lastAgentOutput,
    deps
  )
}
