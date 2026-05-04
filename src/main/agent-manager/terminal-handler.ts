import type { MetricsCollector } from './metrics'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDepsReader } from '../services/epic-dependency-service'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { IUnitOfWork } from '../data/unit-of-work'
import { truncateToNoteLimit } from '../lib/async-utils'
import type { AgentManagerConfig, TerminalResolutionStrategy } from './types'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import { resolveDependents } from '../lib/resolve-dependents'
import type { TerminalDispatcher, TaskStateService } from '../services/task-state-service'

function wrapTransactionWithLogging(
  unitOfWork: IUnitOfWork,
  logger: Logger
): (fn: () => void) => void {
  return (fn) => {
    try {
      unitOfWork.runInTransaction(fn)
    } catch (err) {
      logger.error(`SQLite transaction failed: ${err}`)
      throw err
    }
  }
}

function recordTerminalMetrics(
  taskId: string,
  status: TaskStatus,
  metrics: MetricsCollector,
  logger: Logger
): void {
  if (status === 'done' || status === 'review') {
    metrics.increment('agentsCompleted')
  } else if (status === 'failed' || status === 'error') {
    metrics.increment('agentsFailed')
  }
  logger.event('agent.terminal', { taskId, status, source: 'terminal-handler' })
}

function buildGetSettingFromPolicy(cascadeCancellation: { enabled: boolean } | undefined): (key: string) => string | null {
  return (key) => {
    if (key === 'dependency.cascadeBehavior') {
      return cascadeCancellation?.enabled ? 'cancel' : 'continue'
    }
    return null
  }
}

async function resolveTerminalDependents(
  taskId: string,
  status: TaskStatus,
  depIndex: DependencyIndex,
  epicIndex: EpicDepsReader,
  repo: IAgentTaskRepository,
  unitOfWork: IUnitOfWork,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  logger: Logger,
  cascadeCancellation: { enabled: boolean } | undefined,
  taskStateService?: TaskStateService
): Promise<void> {
  const getSetting = buildGetSettingFromPolicy(cascadeCancellation)
  // DESIGN: Inline resolution for immediate drain loop feedback.
  // When a pipeline agent completes, we resolve dependents synchronously
  // so the drain loop can claim newly-unblocked tasks in the same tick.
  // This differs from task-terminal-service's batched setTimeout(0) approach.
  // See ResolveDependentsParams in types.ts for the conceptual contract.
  //
  // The dep index is NOT rebuilt here. The drain loop keeps the index current
  // via _refreshDependencyIndex() at the top of every tick. If the index is
  // at most one poll interval stale, any missed edges are caught on the next
  // drain tick. The caller sets _depIndexDirty=true so the next tick performs
  // a full rebuild before processing queued tasks.
  const runInTransactionSafe = wrapTransactionWithLogging(unitOfWork, logger)
  try {
    resolveDependents(
      taskId,
      status,
      depIndex,
      repo.getTask,
      repo.updateTask,
      logger,
      getSetting,
      epicIndex,
      repo.getGroup,
      repo.getGroupTasks,
      runInTransactionSafe,
      onTaskTerminal,
      taskStateService
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${errMsg}`)
    const note = `Dependency resolution failed: ${errMsg}. Downstream tasks may remain blocked — check and manually re-queue them.`
    const truncated = truncateToNoteLimit(note)
    // fire-and-forget: best-effort note update for dep-resolution failure
    void repo.updateTask(taskId, { notes: truncated }).catch((updateErr) => {
      logger.error(
        `[agent-manager] Failed to surface dep-resolution failure for ${taskId}: ${updateErr}`
      )
    })
  }
}

export interface TerminalHandlerDeps {
  metrics: MetricsCollector
  depIndex: DependencyIndex
  epicIndex: EpicDepsReader
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  config: AgentManagerConfig
  /** Optional external hook that replaces the default dep-resolution path. */
  terminalResolution?: TerminalResolutionStrategy
  terminalCalled: Map<string, Promise<void>>
  logger: Logger
  taskStateService?: TaskStateService
  /**
   * Typed cascade-cancellation policy. When `enabled` is true, failing tasks
   * with hard dependents cancel those dependents rather than leaving them blocked.
   * Replaces the raw `getSetting` callback — callers resolve the setting once at
   * the composition root and pass the resulting boolean.
   */
  cascadeCancellation?: { enabled: boolean }
}

async function executeTerminal(
  taskId: string,
  status: TaskStatus,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { metrics, depIndex, epicIndex, repo, unitOfWork, logger } = deps
  recordTerminalMetrics(taskId, status, metrics, logger)
  if (deps.terminalResolution) {
    deps.terminalResolution.onStatusTerminal(taskId, status)
  } else {
    await resolveTerminalDependents(
      taskId,
      status,
      depIndex,
      epicIndex,
      repo,
      unitOfWork,
      onTaskTerminal,
      logger,
      deps.cascadeCancellation,
      deps.taskStateService
    )
  }
}

export async function handleTaskTerminal(
  taskId: string,
  status: TaskStatus,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { terminalCalled, logger } = deps

  const existing = terminalCalled.get(taskId)
  if (existing) {
    logger.warn(
      `[agent-manager] onTaskTerminal duplicate for ${taskId} — returning in-flight promise`
    )
    return existing
  }

  const work = executeTerminal(taskId, status, onTaskTerminal, deps)
  terminalCalled.set(taskId, work)
  try {
    await work
  } finally {
    terminalCalled.delete(taskId)
  }
}

/**
 * Wraps `handleTaskTerminal` as a `TerminalDispatcher` so the agent-manager
 * terminal path plugs into `TaskStateService` via the port rather than being
 * called directly.
 *
 * The `onTaskTerminal` parameter is the recursion hook passed to
 * `resolveDependents` — it fires when a downstream task also reaches a
 * terminal state as part of dependency resolution.
 */
export function createAgentTerminalDispatcher(
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  deps: TerminalHandlerDeps
): TerminalDispatcher {
  return {
    dispatch(taskId: string, status: TaskStatus): Promise<void> {
      return handleTaskTerminal(taskId, status, onTaskTerminal, deps)
    }
  }
}
