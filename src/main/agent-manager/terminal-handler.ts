import type { MetricsCollector } from './metrics'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDepsReader } from '../services/epic-dependency-service'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { IUnitOfWork } from '../data/unit-of-work'
import { NOTES_MAX_LENGTH } from './types'
import type { AgentManagerConfig } from './types'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import { resolveDependents } from '../lib/resolve-dependents'
import { getSetting } from '../settings'

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
  logger.info(JSON.stringify({
    event: 'agent.completed',
    taskId,
    status,
    timestamp: new Date().toISOString()
  }))
}

async function resolveTerminalDependents(
  taskId: string,
  status: TaskStatus,
  depIndex: DependencyIndex,
  epicIndex: EpicDepsReader,
  repo: IAgentTaskRepository,
  unitOfWork: IUnitOfWork,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  logger: Logger
): Promise<void> {
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
      onTaskTerminal
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${errMsg}`)
    const note = `Dependency resolution failed: ${errMsg}. Downstream tasks may remain blocked — check and manually re-queue them.`
    const truncated =
      note.length > NOTES_MAX_LENGTH ? note.slice(0, NOTES_MAX_LENGTH - 3) + '...' : note
    try {
      repo.updateTask(taskId, { notes: truncated })
    } catch (updateErr) {
      logger.error(
        `[agent-manager] Failed to surface dep-resolution failure for ${taskId}: ${updateErr}`
      )
    }
  }
}

export interface TerminalHandlerDeps {
  metrics: MetricsCollector
  depIndex: DependencyIndex
  epicIndex: EpicDepsReader
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  config: AgentManagerConfig
  terminalCalled: Map<string, Promise<void>>
  logger: Logger
}

async function executeTerminal(
  taskId: string,
  status: TaskStatus,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { metrics, depIndex, epicIndex, repo, unitOfWork, config, logger } = deps
  recordTerminalMetrics(taskId, status, metrics, logger)
  if (config.onStatusTerminal) {
    config.onStatusTerminal(taskId, status)
  } else {
    await resolveTerminalDependents(
      taskId,
      status,
      depIndex,
      epicIndex,
      repo,
      unitOfWork,
      onTaskTerminal,
      logger
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
