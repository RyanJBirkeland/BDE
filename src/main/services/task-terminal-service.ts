import { resolveDependents } from '../agent-manager/resolve-dependents'
import {
  createDependencyIndex,
  type DependencyIndex,
  TERMINAL_STATUSES
} from './dependency-service'
import { createEpicDependencyIndex, type EpicDependencyIndex } from './epic-dependency-service'
import type { SprintTask, TaskDependency, TaskGroup, EpicDependency } from '../../shared/types'
import { broadcast } from '../broadcast'
import { getErrorMessage } from '../../shared/errors'

type TaskSlice = Pick<SprintTask, 'id' | 'status' | 'notes' | 'title' | 'group_id'> & {
  depends_on: TaskDependency[] | null
}

export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  getGroup: (id: string) => TaskGroup | null
  getGroupsWithDependencies: () => Array<{ id: string; depends_on: EpicDependency[] | null }>
  listGroupTasks: (groupId: string) => SprintTask[]
  getSetting?: (key: string) => string | null
  // TODO F-t1-datalay-4: pass a db.transaction wrapper here to enable cascade atomicity.
  // When provided, the entire cascade cancellation loop is wrapped in a single SQLite transaction.
  runInTransaction?: (fn: () => void) => void
  logger: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
    debug: (msg: string) => void
  }
}

export interface TaskTerminalService {
  onStatusTerminal: (taskId: string, status: string) => void
}

class BatchedTaskResolver {
  private pending = new Map<string, string>() // taskId → terminal status
  private timer: ReturnType<typeof setTimeout> | null = null

  schedule(taskId: string, status: string, execute: (pending: Map<string, string>) => void): void {
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
  const epicIndex: EpicDependencyIndex = createEpicDependencyIndex()
  const resolver = new BatchedTaskResolver()

  function rebuildIndex(): void {
    const tasks = deps.getTasksWithDependencies()
    depIndex.rebuild(tasks)
    const groups = deps.getGroupsWithDependencies()
    epicIndex.rebuild(groups)
  }

  function scheduleResolution(taskId: string, status: string): void {
    // DESIGN: Batched resolution via setTimeout(0) for bulk PR merges.
    // When multiple PRs merge simultaneously (e.g., sprint PR poller tick),
    // we rebuild the dependency index once and process all resolutions together.
    // This differs from agent-manager's inline synchronous approach.
    // See ResolveDependentsParams in agent-manager/types.ts for the conceptual contract.
    resolver.schedule(taskId, status, (pending) => {
      try {
        rebuildIndex() // Rebuild once for the batch
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
              epicIndex,
              deps.getGroup,
              deps.listGroupTasks,
              deps.runInTransaction
            )
          } catch (err) {
            failedTaskIds.push(id)
            deps.logger.error(
              `[task-terminal-service] resolveDependents failed for ${id}: ${err}`
            )
          }
        }
        // Consolidated error summary so the full set of failures is visible
        // in one log entry rather than scattered per-task.
        if (failedTaskIds.length > 0) {
          deps.logger.error(
            `[task-terminal-service] ${failedTaskIds.length} of ${totalCount} dependency resolutions failed — failed task IDs: ${failedTaskIds.join(', ')}`
          )
        }
      } catch (err) {
        deps.logger.error(`[task-terminal-service] rebuildIndex failed: ${err}`)
        broadcast('task-terminal:resolution-error', { error: getErrorMessage(err) })
      }
    })
  }

  function onStatusTerminal(taskId: string, status: string): void {
    if (!TERMINAL_STATUSES.has(status)) return
    scheduleResolution(taskId, status)
  }

  return { onStatusTerminal }
}
