import type { DependencyIndex } from './dependency-index'
import type { SprintTask, TaskDependency } from '../../shared/types'
import type { Logger } from './types'
import { buildBlockedNotes } from './dependency-helpers'

/**
 * When a task reaches a terminal status, check all tasks that depend on it.
 * Any dependent that is currently `blocked` and has all its deps satisfied
 * will be transitioned to `queued`.
 *
 * All dependency statuses are fetched fresh via `getTask` so fan-in scenarios
 * (multiple deps) are handled correctly without stale data.
 */
export async function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (
    id: string,
  ) => Promise<(Pick<SprintTask, 'id' | 'status' | 'notes'> & { depends_on: TaskDependency[] | null }) | null>,
  updateTask: (id: string, patch: Record<string, unknown>) => Promise<unknown>,
  logger?: Logger,
): Promise<void> {
  const dependents = index.getDependents(completedTaskId)
  if (dependents.size === 0) return

  for (const depId of dependents) {
    try {
      const task = await getTask(depId)
      if (!task || task.status !== 'blocked') continue
      if (!task.depends_on || task.depends_on.length === 0) continue

      // Build a status cache; seed with the task we just completed so we
      // don't need a redundant DB round-trip for it.
      const statusCache = new Map<string, string | undefined>()
      statusCache.set(completedTaskId, completedStatus)

      for (const dep of task.depends_on) {
        if (!statusCache.has(dep.id)) {
          const depTask = await getTask(dep.id)
          statusCache.set(dep.id, depTask?.status)
        }
      }

      const { satisfied, blockedBy } = index.areDependenciesSatisfied(
        depId,
        task.depends_on,
        (id) => statusCache.get(id),
      )

      if (satisfied) {
        // Unblock the task (keep existing notes as-is)
        await updateTask(depId, { status: 'queued' })
      } else if (blockedBy.length > 0) {
        // Update blocking notes with current blocking dependencies, preserving user notes
        const currentTask = await getTask(depId)
        await updateTask(depId, { notes: buildBlockedNotes(blockedBy, currentTask?.notes ?? null) })
      }
    } catch (err) {
      ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
    }
  }
}
