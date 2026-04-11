import type { SprintTask, TaskDependency } from '../../shared/types'
import type { Logger } from '../logger'
import {
  type DependencyIndex,
  buildBlockedNotes,
  FAILURE_STATUSES
} from '../services/dependency-service'

/**
 * When a task reaches a terminal status, check all tasks that depend on it.
 * Any dependent that is currently `blocked` and has all its deps satisfied
 * will be transitioned to `queued`.
 *
 * If cascade cancellation is enabled and the completed task failed with a hard dependency,
 * all blocked downstream tasks are recursively cancelled.
 *
 * All dependency statuses are fetched fresh via `getTask` so fan-in scenarios
 * (multiple deps) are handled correctly without stale data.
 */
export function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (id: string) =>
    | (Pick<SprintTask, 'id' | 'status' | 'notes' | 'title'> & {
        depends_on: TaskDependency[] | null
      })
    | null,
  updateTask: (id: string, patch: Record<string, unknown>) => unknown,
  logger?: Logger,
  getSetting?: (key: string) => string | null
): void {
  const dependents = index.getDependents(completedTaskId)
  if (dependents.size === 0) return

  // Check if cascade cancellation is enabled (default: 'continue' for backward compat)
  const cascadeBehavior = getSetting?.('dependency.cascadeBehavior') ?? 'continue'
  const shouldCascadeCancel = cascadeBehavior === 'cancel' && FAILURE_STATUSES.has(completedStatus)

  for (const depId of dependents) {
    try {
      const task = getTask(depId)
      if (!task || task.status !== 'blocked') continue
      if (!task.depends_on || task.depends_on.length === 0) continue

      // Build a status cache; seed with the task we just completed so we
      // don't need a redundant DB round-trip for it.
      const statusCache = new Map<string, string | undefined>()
      statusCache.set(completedTaskId, completedStatus)

      for (const dep of task.depends_on) {
        if (!statusCache.has(dep.id)) {
          const depTask = getTask(dep.id)
          statusCache.set(dep.id, depTask?.status)
        }
      }

      // Check if this task has a hard dependency on the failed task
      const hasHardDepOnFailed = task.depends_on.some(
        (dep) => dep.id === completedTaskId && dep.type === 'hard'
      )

      // If cascade cancel is enabled and this task has a hard dep on the failed task, cancel it
      if (shouldCascadeCancel && hasHardDepOnFailed) {
        const failedTask = getTask(completedTaskId)
        const failedTitle = failedTask?.title ?? completedTaskId
        const cancelNote = `[auto-cancel] Upstream task "${failedTitle}" failed`
        updateTask(depId, { status: 'cancelled', notes: cancelNote })

        // Recursively cancel this task's blocked dependents
        resolveDependents(depId, 'cancelled', index, getTask, updateTask, logger, getSetting)
        continue
      }

      const { satisfied, blockedBy } = index.areDependenciesSatisfied(
        depId,
        task.depends_on,
        (id) => statusCache.get(id)
      )

      if (satisfied) {
        // Unblock the task (keep existing notes as-is)
        updateTask(depId, { status: 'queued' })
      } else if (blockedBy.length > 0) {
        // Update blocking notes with current blocking dependencies, preserving user notes
        const currentTask = getTask(depId)
        updateTask(depId, { notes: buildBlockedNotes(blockedBy, currentTask?.notes ?? null) })
      }
    } catch (err) {
      ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
    }
  }
}
