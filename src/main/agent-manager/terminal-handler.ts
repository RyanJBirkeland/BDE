import type { MetricsCollector } from './metrics'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDepsReader } from '../services/epic-dependency-service'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { NOTES_MAX_LENGTH } from './types'
import type { AgentManagerConfig } from './types'
import type { Logger } from '../logger'
import { createLogger } from '../logger'
import { resolveDependents } from '../lib/resolve-dependents'
import { getSetting } from '../settings'
import { getDb } from '../db'

const logger = createLogger('terminal-handler')

/**
 * Wraps a synchronous function in a better-sqlite3 transaction so cascade
 * cancellations are atomic — partial failures roll back the whole batch.
 */
function runInTransactionSafe(fn: () => void): void {
  const db = getDb()
  const tx = db.transaction(fn)
  try {
    tx()
  } catch (err) {
    // Log with module context before propagating — the outer caller's catch
    // has the taskId but not the transaction scope.
    logger.error(`SQLite transaction failed: ${err}`)
    throw err
  }
}

function recordTerminalMetrics(status: string, metrics: MetricsCollector): void {
  if (status === 'done' || status === 'review') {
    metrics.increment('agentsCompleted')
  } else if (status === 'failed' || status === 'error') {
    metrics.increment('agentsFailed')
  }
}

async function resolveTerminalDependents(
  taskId: string,
  status: string,
  depIndex: DependencyIndex,
  epicIndex: EpicDepsReader,
  repo: IAgentTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
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
  config: AgentManagerConfig
  terminalCalled: Map<string, Promise<void>>
  logger: Logger
}

async function executeTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { metrics, depIndex, epicIndex, repo, config, logger } = deps
  recordTerminalMetrics(status, metrics)
  if (config.onStatusTerminal) {
    config.onStatusTerminal(taskId, status)
  } else {
    await resolveTerminalDependents(
      taskId,
      status,
      depIndex,
      epicIndex,
      repo,
      onTaskTerminal,
      logger
    )
  }
}

export async function handleTaskTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
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
