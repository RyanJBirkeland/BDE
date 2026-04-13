import type { MetricsCollector } from './metrics'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDependencyIndex } from '../services/epic-dependency-service'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { AgentManagerConfig } from './types'
import type { Logger } from '../logger'
import { resolveDependents } from './resolve-dependents'
import { getSetting } from '../settings'

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
  epicIndex: EpicDependencyIndex,
  repo: ISprintTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  logger: Logger
): Promise<void> {
  // DESIGN: Inline resolution for immediate drain loop feedback.
  // When a pipeline agent completes, we resolve dependents synchronously
  // so the drain loop can claim newly-unblocked tasks in the same tick.
  // This differs from task-terminal-service's batched setTimeout(0) approach.
  // See ResolveDependentsParams in types.ts for the conceptual contract.
  // Rebuild dep index first to pick up any tasks created/modified since
  // the last drain tick — stale index causes missed unblocking.
  try {
    const freshTasks = repo.getTasksWithDependencies()
    depIndex.rebuild(freshTasks)
  } catch (rebuildErr) {
    logger.warn(
      `[agent-manager] dep index rebuild failed before resolution for ${taskId}: ${rebuildErr}`
    )
  }
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
      undefined,
      onTaskTerminal
    )
  } catch (err) {
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
  }
}

export interface TerminalHandlerDeps {
  metrics: MetricsCollector
  depIndex: DependencyIndex
  epicIndex: EpicDependencyIndex
  repo: ISprintTaskRepository
  config: AgentManagerConfig
  terminalCalled: Set<string>
  logger: Logger
}

export async function handleTaskTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { metrics, depIndex, epicIndex, repo, config, terminalCalled, logger } = deps

  // F-t4-lifecycle-5: Guard against double-invocation when watchdog and completion handler race
  if (terminalCalled.has(taskId)) {
    logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }
  terminalCalled.add(taskId)

  try {
    recordTerminalMetrics(status, metrics)
    if (config.onStatusTerminal) {
      config.onStatusTerminal(taskId, status)
    } else {
      await resolveTerminalDependents(taskId, status, depIndex, epicIndex, repo, onTaskTerminal, logger)
    }
  } finally {
    // Clean up after 5 seconds to prevent unbounded memory growth
    setTimeout(() => terminalCalled.delete(taskId), 5000)
  }
}
