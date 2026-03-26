/**
 * Abstract interface for sprint task data access.
 * Allows the agent manager to be tested with mock implementations
 * instead of module-level vi.mock() on sprint-queries.
 */
import type { SprintTask, TaskDependency } from '../../shared/types'
import * as queries from './sprint-queries'

export interface ISprintTaskRepository {
  getTask(id: string): Promise<SprintTask | null>
  updateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null>
  getQueuedTasks(limit: number): Promise<SprintTask[]>
  getTasksWithDependencies(): Promise<
    Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
  >
  getOrphanedTasks(claimedBy: string): Promise<SprintTask[]>
  getActiveTaskCount(): Promise<number>
  claimTask(id: string, claimedBy: string): Promise<SprintTask | null>
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
    claimTask: queries.claimTask,
  }
}
