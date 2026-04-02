import { resolveDependents } from '../agent-manager/resolve-dependents'
import { createDependencyIndex } from '../agent-manager/dependency-index'
import type { DependencyIndex } from '../agent-manager/dependency-index'
import type { SprintTask, TaskDependency } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'cancelled'])

type TaskSlice = Pick<SprintTask, 'id' | 'status' | 'notes'> & {
  depends_on: TaskDependency[] | null
}

export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export interface TaskTerminalService {
  onStatusTerminal: (taskId: string, status: string) => void
}

export function createTaskTerminalService(deps: TaskTerminalServiceDeps): TaskTerminalService {
  const depIndex: DependencyIndex = createDependencyIndex()

  function rebuildIndex(): void {
    const tasks = deps.getTasksWithDependencies()
    depIndex.rebuild(tasks)
  }

  function onStatusTerminal(taskId: string, status: string): void {
    if (!TERMINAL_STATUSES.has(status)) return
    try {
      rebuildIndex()
      resolveDependents(taskId, status, depIndex, deps.getTask, deps.updateTask, deps.logger)
    } catch (err) {
      deps.logger.error(`[task-terminal-service] resolveDependents failed for ${taskId}: ${err}`)
    }
  }

  return { onStatusTerminal }
}
