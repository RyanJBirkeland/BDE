/**
 * Abstract interface for sprint task data access.
 * Allows the agent manager to be tested with mock implementations
 * instead of module-level vi.mock() on sprint-queries.
 *
 * DL-31: This interface covers only the 7 operations needed by agent-manager.
 * Other query functions (listTasks, createTask, deleteTask, etc.) are called
 * directly by IPC handlers and Queue API. Future work: expand this interface
 * to cover all sprint-queries functions for full repository pattern coverage.
 */
import type { SprintTask, TaskDependency } from '../../shared/types'
import * as queries from './sprint-queries'

export interface ISprintTaskRepository {
  getTask(id: string): SprintTask | null
  updateTask(id: string, patch: Record<string, unknown>): SprintTask | null
  getQueuedTasks(limit: number): SprintTask[]
  getTasksWithDependencies(): Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
  getOrphanedTasks(claimedBy: string): SprintTask[]
  getActiveTaskCount(): number
  claimTask(id: string, claimedBy: string): SprintTask | null
}

/**
 * Concrete implementation that delegates to sprint-queries functions.
 * This is the only place that imports sprint-queries for agent-manager use.
 */
export function createSprintTaskRepository(): ISprintTaskRepository {
  return {
    getTask: queries.getTask,
    updateTask: queries.updateTask,
    getQueuedTasks: queries.getQueuedTasks,
    getTasksWithDependencies: queries.getTasksWithDependencies,
    getOrphanedTasks: queries.getOrphanedTasks,
    getActiveTaskCount: queries.getActiveTaskCount,
    claimTask: queries.claimTask
  }
}
