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

export function createTaskTerminalService(deps: TaskTerminalServiceDeps): TaskTerminalService {
  const depIndex: DependencyIndex = createDependencyIndex()
  const epicIndex: EpicDependencyIndex = createEpicDependencyIndex()

  // Pending resolution: taskIds that have reached terminal status and need dep resolution.
  // setTimeout(0) coalesces multiple synchronous completions into one resolution pass.
  const _pendingResolution = new Map<string, string>() // taskId → terminal status
  let _resolveTimer: ReturnType<typeof setTimeout> | null = null

  function rebuildIndex(): void {
    const tasks = deps.getTasksWithDependencies()
    depIndex.rebuild(tasks)
    const groups = deps.getGroupsWithDependencies()
    epicIndex.rebuild(groups)
  }

  function scheduleResolution(taskId: string, status: string): void {
    _pendingResolution.set(taskId, status)
    if (!_resolveTimer) {
      _resolveTimer = setTimeout(() => {
        _resolveTimer = null
        try {
          rebuildIndex() // Rebuild once for the batch
          // DESIGN: Batched resolution via setTimeout(0) for bulk PR merges.
          // When multiple PRs merge simultaneously (e.g., sprint PR poller tick),
          // we rebuild the dependency index once and process all resolutions together.
          // This differs from agent-manager's inline synchronous approach.
          // See ResolveDependentsParams in agent-manager/types.ts for the conceptual contract.
          const failedTaskIds: string[] = []
          const totalCount = _pendingResolution.size
          for (const [id, terminalStatus] of _pendingResolution) {
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
                deps.listGroupTasks
              )
            } catch (err) {
              failedTaskIds.push(id)
              deps.logger.error(
                `[task-terminal-service] resolveDependents failed for ${id}: ${err}`
              )
            }
          }
          // F-t3-audit-trail-5: consolidated error summary so the full set of
          // failures is visible in one log entry rather than scattered per-task.
          if (failedTaskIds.length > 0) {
            deps.logger.error(
              `[task-terminal-service] ${failedTaskIds.length} of ${totalCount} dependency resolutions failed — failed task IDs: ${failedTaskIds.join(', ')}`
            )
          }
        } catch (err) {
          deps.logger.error(`[task-terminal-service] rebuildIndex failed: ${err}`)
          broadcast('task-terminal:resolution-error', { error: getErrorMessage(err) })
        } finally {
          _pendingResolution.clear()
        }
      }, 0)
    }
  }

  function onStatusTerminal(taskId: string, status: string): void {
    if (!TERMINAL_STATUSES.has(status)) return
    scheduleResolution(taskId, status)
  }

  return { onStatusTerminal }
}
