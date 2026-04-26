import { resolveDependents } from '../lib/resolve-dependents'
import type { TaskStateService } from './task-state-service'
import {
  createDependencyIndex,
  type DependencyIndex,
  TERMINAL_STATUSES
} from './dependency-service'
import type { EpicDepsReader } from './epic-dependency-service'
import type { SprintTask, TaskDependency, TaskGroup } from '../../shared/types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { getErrorMessage } from '../../shared/errors'
import { refreshDependencyIndex, type DepsFingerprint } from '../agent-manager/dependency-refresher'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { TerminalDispatcher } from './task-state-service'

type TaskSlice = Pick<SprintTask, 'id' | 'status' | 'notes' | 'title' | 'group_id'> & {
  depends_on: TaskDependency[] | null
}

export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{
    id: string
    depends_on: TaskDependency[] | null
    status: string
  }>
  getGroup: (id: string) => TaskGroup | null
  listGroupTasks: (groupId: string) => SprintTask[]
  /** Canonical epic dependency graph, owned by EpicGroupService. */
  epicDepsReader: EpicDepsReader
  getSetting?: (key: string) => string | null
  runInTransaction?: (fn: () => void) => void
  taskStateService?: TaskStateService
  broadcast?: (channel: string, payload?: Record<string, unknown>) => void
  logger: Logger
}

export interface TaskTerminalService {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void
}

class BatchedTaskResolver {
  private pending = new Map<string, TaskStatus>() // taskId → terminal status
  private timer: ReturnType<typeof setTimeout> | null = null

  schedule(
    taskId: string,
    status: TaskStatus,
    execute: (pending: Map<string, TaskStatus>) => void
  ): void {
    this.pending.set(taskId, status)
    if (!this.timer) {
      this.timer = setTimeout(() => {
        const snapshot = new Map(this.pending)
        this.pending.clear()
        this.timer = null
        execute(snapshot)
      }, 0)
    }
  }
}

export function createTaskTerminalService(deps: TaskTerminalServiceDeps): TaskTerminalService {
  const depIndex: DependencyIndex = createDependencyIndex()
  const resolver = new BatchedTaskResolver()
  const fingerprints: DepsFingerprint = new Map()

  function refreshTaskDepIndex(): void {
    // Use incremental refresher for task dependencies (same as agent-manager drain loop)
    // to avoid stale index issues when tasks are created after last refresh.
    const repo = { getTasksWithDependencies: deps.getTasksWithDependencies } as Pick<
      IAgentTaskRepository,
      'getTasksWithDependencies'
    >
    refreshDependencyIndex(depIndex, fingerprints, repo as IAgentTaskRepository, deps.logger)
    // Epic dependency graph is owned by EpicGroupService — read via deps.epicDepsReader.
  }

  function scheduleDependencyResolution(taskId: string, status: TaskStatus): void {
    // DESIGN: Batched resolution via setTimeout(0) for bulk PR merges.
    // When multiple PRs merge simultaneously (e.g., sprint PR poller tick),
    // we rebuild the dependency index once and process all resolutions together.
    // This differs from agent-manager's inline synchronous approach.
    // See ResolveDependentsParams in agent-manager/types.ts for the conceptual contract.
    resolver.schedule(taskId, status, (pending) => {
      try {
        refreshTaskDepIndex() // Refresh task graph once for the batch; epic graph is always live.
        const failedTaskIds: string[] = []
        const totalCount = pending.size
        for (const [id, terminalStatus] of pending) {
          try {
            resolveDependents(
              id,
              terminalStatus,
              depIndex,
              deps.getTask,
              deps.updateTask,
              deps.logger,
              deps.getSetting,
              deps.epicDepsReader,
              deps.getGroup,
              deps.listGroupTasks,
              deps.runInTransaction,
              undefined,
              deps.taskStateService
            )
          } catch (err) {
            failedTaskIds.push(id)
            deps.logger.error(`[task-terminal-service] resolveDependents failed for ${id}: ${err}`)
          }
        }
        deps.logger.info(
          `[task-terminal] resolved ${totalCount - failedTaskIds.length} dependents in ${totalCount} tasks`
        )
        if (failedTaskIds.length > 0) {
          deps.logger.error(
            `[task-terminal-service] ${failedTaskIds.length} of ${totalCount} dependency resolutions failed — failed task IDs: ${failedTaskIds.join(', ')}`
          )
        }
      } catch (err) {
        deps.logger.error(`[task-terminal-service] refreshTaskDepIndex failed: ${err}`)
        deps.broadcast?.('task-terminal:resolution-error', { error: getErrorMessage(err) })
      }
    })
  }

  function onStatusTerminal(taskId: string, status: TaskStatus): void {
    if (!TERMINAL_STATUSES.has(status)) return
    scheduleDependencyResolution(taskId, status)
  }

  return { onStatusTerminal }
}

/**
 * Wraps `TaskTerminalService.onStatusTerminal` as a `TerminalDispatcher` so
 * the PR-poller / manual terminal path plugs into `TaskStateService` via the
 * port rather than being called directly.
 */
export function createPollerTerminalDispatcher(service: TaskTerminalService): TerminalDispatcher {
  return {
    dispatch(taskId: string, status: TaskStatus): void {
      service.onStatusTerminal(taskId, status)
    }
  }
}
