import { resolveDependents } from '../agent-manager/resolve-dependents'
import { createDependencyIndex } from '../agent-manager/dependency-index'
import type { DependencyIndex } from '../agent-manager/dependency-index'
import type { SprintTask, TaskDependency } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'cancelled'])

type TaskSlice = Pick<SprintTask, 'id' | 'status' | 'notes' | 'title'> & {
  depends_on: TaskDependency[] | null
}

export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  getSetting?: (key: string) => string | null
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export interface TaskTerminalService {
  onStatusTerminal: (taskId: string, status: string) => void
}

export function createTaskTerminalService(deps: TaskTerminalServiceDeps): TaskTerminalService {
  const depIndex: DependencyIndex = createDependencyIndex()

  // Pending resolution: taskIds that have reached terminal status and need dep resolution.
  // setTimeout(0) coalesces multiple synchronous completions into one resolution pass.
  const _pendingResolution = new Map<string, string>() // taskId → terminal status
  let _resolveTimer: ReturnType<typeof setTimeout> | null = null

  function rebuildIndex(): void {
    const tasks = deps.getTasksWithDependencies()
    depIndex.rebuild(tasks)
  }

  function scheduleResolution(taskId: string, status: string): void {
    _pendingResolution.set(taskId, status)
    if (!_resolveTimer) {
      _resolveTimer = setTimeout(() => {
        _resolveTimer = null
        try {
          rebuildIndex() // Rebuild once for the batch
          for (const [id, terminalStatus] of _pendingResolution) {
            try {
              resolveDependents(
                id,
                terminalStatus,
                depIndex,
                deps.getTask,
                deps.updateTask,
                deps.logger,
                deps.getSetting
              )
            } catch (err) {
              deps.logger.error(
                `[task-terminal-service] resolveDependents failed for ${id}: ${err}`
              )
            }
          }
        } catch (err) {
          deps.logger.error(`[task-terminal-service] rebuildIndex failed: ${err}`)
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
