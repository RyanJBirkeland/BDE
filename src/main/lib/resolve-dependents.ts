import type { SprintTask, TaskDependency, TaskGroup } from '../../shared/types'
import type { Logger } from '../logger'
import {
  type DependencyIndex,
  buildBlockedNotes,
  computeBlockState,
  FAILURE_STATUSES,
  TERMINAL_STATUSES
} from '../services/dependency-service'
import type { EpicDependencyIndex } from '../services/epic-dependency-service'

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
 *
 * Phase 2: After task-level resolution, checks if the completed task's epic has
 * any dependent epics whose dependencies are now satisfied, and unblocks their tasks.
 */
export function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (id: string) =>
    | (Pick<SprintTask, 'id' | 'status' | 'notes' | 'title' | 'group_id'> & {
        depends_on: TaskDependency[] | null
      })
    | null,
  updateTask: (id: string, patch: Record<string, unknown>) => unknown,
  logger?: Logger,
  getSetting?: (key: string) => string | null,
  epicIndex?: EpicDependencyIndex,
  getGroup?: (id: string) => TaskGroup | null,
  listGroupTasks?: (groupId: string) => SprintTask[],
  runInTransaction?: (fn: () => void) => void,
  onTaskTerminal?: (taskId: string, status: string) => void
): void {
  // Guard: only process terminal statuses — calling with active/queued/blocked
  // produces nonsensical cascade-cancel and satisfaction results.
  if (!TERMINAL_STATUSES.has(completedStatus)) {
    logger?.warn(
      `[resolve-dependents] Called with non-terminal status "${completedStatus}" for task ${completedTaskId} — skipping`
    )
    return
  }

  const dependents = index.getDependents(completedTaskId)
  if (dependents.size === 0) return

  // Check if cascade cancellation is enabled (default: 'continue' for backward compat)
  const cascadeBehavior = getSetting?.('dependency.cascadeBehavior') ?? 'continue'
  const shouldCascadeCancel = cascadeBehavior === 'cancel' && FAILURE_STATUSES.has(completedStatus)

  // Process a single dependent. When shouldCascadeCancel is true and the dependent has
  // a hard dep on the failed task, cancel it. Otherwise fall through to normal unblocking.
  const processDependent = (depId: string): void => {
    const task = getTask(depId)
    if (!task || task.status !== 'blocked') return
    if (!task.depends_on || task.depends_on.length === 0) return

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
      // Notify terminal listeners so dependents of this cancelled task are resolved.
      // Re-throw on failure: if onTaskTerminal fails the dependency index may be
      // stale, and continuing the recursive cascade on stale state produces
      // incorrect results (orphaned blocked tasks). Let the caller's try/catch
      // decide whether to abort the whole cascade or log and continue.
      try {
        onTaskTerminal?.(depId, 'cancelled')
      } catch (err) {
        ;(logger ?? console).warn(
          `[resolve-dependents] onTaskTerminal threw for ${depId}: ${err}`
        )
        throw err
      }
      // Recursively cancel this task's blocked dependents — pass runInTransaction
      // so nested cascades are also wrapped in the outer transaction
      resolveDependents(
        depId,
        'cancelled',
        index,
        getTask,
        updateTask,
        logger,
        getSetting,
        epicIndex,
        getGroup,
        listGroupTasks,
        runInTransaction,
        onTaskTerminal
      )
      return
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
  }

  if (shouldCascadeCancel && runInTransaction) {
    // Cascade path with transaction: wrap the entire loop atomically so
    // partial-cancel failures roll back the whole batch.
    const runCascadeLoop = (): void => {
      for (const depId of dependents) {
        processDependent(depId)
      }
    }
    runInTransaction(runCascadeLoop)
  } else {
    // Non-cascade or no transaction: per-dependent try/catch for fault isolation
    for (const depId of dependents) {
      try {
        processDependent(depId)
      } catch (err) {
        ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
      }
    }
  }

  // Phase 2: Epic-level cascade
  // If the completed task is in an epic, check if any dependent epics can now be unblocked
  if (!epicIndex || !getGroup || !listGroupTasks) return

  const completedTask = getTask(completedTaskId)
  if (!completedTask?.group_id) return

  const dependentEpics = epicIndex.getDependentEpics(completedTask.group_id)
  if (dependentEpics.size === 0) return

  for (const depEpicId of dependentEpics) {
    try {
      const depEpic = getGroup(depEpicId)
      if (!depEpic || !depEpic.depends_on || depEpic.depends_on.length === 0) continue

      // Build status cache for all epics and their tasks
      const epicStatusMap = new Map<string, string>()
      const tasksByEpic = new Map<string, Array<{ status: string }>>()

      // Helper to ensure we've cached an epic's data
      const cacheEpic = (epicId: string): void => {
        if (epicStatusMap.has(epicId)) return
        const epic = getGroup(epicId)
        if (epic) {
          epicStatusMap.set(epicId, epic.status)
          const tasks = listGroupTasks(epicId)
          tasksByEpic.set(
            epicId,
            tasks.map((t) => ({ status: t.status }))
          )
        }
      }

      // Cache the dependent epic and all its dependencies
      cacheEpic(depEpicId)
      for (const dep of depEpic.depends_on) {
        cacheEpic(dep.id)
      }

      // Check if the dependent epic's dependencies are satisfied
      const { satisfied } = epicIndex.areEpicDepsSatisfied(
        depEpicId,
        depEpic.depends_on,
        (id) => epicStatusMap.get(id),
        (id) => tasksByEpic.get(id)
      )

      if (!satisfied) continue

      // Epic deps are now satisfied — unblock any blocked tasks in this epic
      // whose fresh computeBlockState check shows shouldBlock: false
      const tasksInDepEpic = listGroupTasks(depEpicId)
      for (const task of tasksInDepEpic) {
        if (task.status !== 'blocked') continue

        // Re-check block state with fresh data
        const { shouldBlock, blockedBy } = computeBlockState(task, {
          logger: logger ?? {
            warn: console.warn,
            info: console.info,
            error: console.error,
            debug: console.debug
          },
          listTasks: () => {
            // Build a fresh task list from all known epics
            const allTasks: SprintTask[] = []
            for (const epicId of [depEpicId, ...Array.from(epicStatusMap.keys())]) {
              allTasks.push(...listGroupTasks(epicId))
            }
            // Include the completed task if it's not already in the list
            if (completedTask && !allTasks.some((t) => t.id === completedTaskId)) {
              allTasks.push(completedTask as SprintTask)
            }
            return allTasks
          },
          listGroups: () => {
            // Build a fresh group list from all known epics
            const allGroups: TaskGroup[] = []
            for (const epicId of [depEpicId, ...Array.from(epicStatusMap.keys())]) {
              const epic = getGroup(epicId)
              if (epic) allGroups.push(epic)
            }
            return allGroups
          }
        })

        if (!shouldBlock) {
          // Unblock the task (keep existing notes as-is)
          updateTask(task.id, { status: 'queued' })
        } else if (blockedBy.length > 0) {
          // Update blocking notes with current blocking dependencies
          updateTask(task.id, { notes: buildBlockedNotes(blockedBy, task.notes ?? null) })
        }
      }
    } catch (err) {
      ;(logger ?? console).warn(
        `[resolve-dependents] Error resolving dependent epic ${depEpicId}: ${err}`
      )
    }
  }
}
