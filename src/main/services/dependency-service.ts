/**
 * Shared domain service for task dependency management.
 * Consolidates dependency checking, cycle detection, and status classification.
 */

import type { SprintTask, TaskDependency } from '../../shared/types'
import type { Logger } from '../logger'
import {
  TERMINAL_STATUSES,
  FAILURE_STATUSES,
  HARD_SATISFIED_STATUSES
} from '../../shared/task-transitions'

// Re-export canonical status sets
export { TERMINAL_STATUSES, FAILURE_STATUSES, HARD_SATISFIED_STATUSES }

export interface DependencyIndex {
  rebuild(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>): void
  update(taskId: string, deps: TaskDependency[] | null): void
  remove(taskId: string): void
  getDependents(taskId: string): Set<string>
  areDependenciesSatisfied(
    taskId: string,
    deps: TaskDependency[],
    getTaskStatus: (id: string) => string | undefined
  ): { satisfied: boolean; blockedBy: string[] }
}

export function createDependencyIndex(): DependencyIndex {
  const reverseMap = new Map<string, Set<string>>()
  const forwardMap = new Map<string, Set<string>>()

  function addEdges(taskId: string, deps: TaskDependency[] | null): void {
    if (!deps || deps.length === 0) {
      forwardMap.delete(taskId)
      return
    }
    const depIds = new Set<string>()
    for (const dep of deps) {
      depIds.add(dep.id)
      let set = reverseMap.get(dep.id)
      if (!set) {
        set = new Set()
        reverseMap.set(dep.id, set)
      }
      set.add(taskId)
    }
    forwardMap.set(taskId, depIds)
  }

  function removeEdges(taskId: string): void {
    const oldDeps = forwardMap.get(taskId)
    if (oldDeps) {
      for (const depId of oldDeps) {
        const dependents = reverseMap.get(depId)
        if (dependents) {
          dependents.delete(taskId)
          if (dependents.size === 0) {
            reverseMap.delete(depId)
          }
        }
      }
    }
    forwardMap.delete(taskId)
  }

  return {
    rebuild(tasks) {
      reverseMap.clear()
      forwardMap.clear()
      for (const task of tasks) addEdges(task.id, task.depends_on)
    },
    update(taskId, deps) {
      removeEdges(taskId)
      addEdges(taskId, deps)
    },
    remove(taskId) {
      removeEdges(taskId)
      reverseMap.delete(taskId)
    },
    getDependents(taskId) {
      return reverseMap.get(taskId) ?? new Set()
    },
    areDependenciesSatisfied(_taskId, deps, getTaskStatus) {
      if (deps.length === 0) return { satisfied: true, blockedBy: [] }
      const blockedBy: string[] = []
      for (const dep of deps) {
        const status = getTaskStatus(dep.id)
        if (status === undefined) continue // deleted dep = satisfied

        // If condition is specified, use condition-based logic
        if (dep.condition) {
          if (dep.condition === 'on_success') {
            if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)
          } else if (dep.condition === 'on_failure') {
            if (!FAILURE_STATUSES.has(status)) blockedBy.push(dep.id)
          } else if (dep.condition === 'always') {
            if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)
          }
        } else {
          // No condition = fallback to hard/soft behavior (backward compatibility)
          if (dep.type === 'hard') {
            if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)
          } else {
            if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)
          }
        }
      }
      return { satisfied: blockedBy.length === 0, blockedBy }
    }
  }
}

export function detectCycle(
  taskId: string,
  proposedDeps: TaskDependency[],
  getDepsForTask: (id: string) => TaskDependency[] | null
): string[] | null {
  for (const dep of proposedDeps) {
    if (dep.id === taskId) return [taskId, taskId]
  }
  for (const dep of proposedDeps) {
    const visited = new Set<string>()
    const path: string[] = [taskId, dep.id]
    function dfs(current: string): string[] | null {
      if (current === taskId) return [...path]
      if (visited.has(current)) return null
      visited.add(current)
      const deps = getDepsForTask(current)
      if (!deps) return null
      for (const d of deps) {
        path.push(d.id)
        const result = dfs(d.id)
        if (result) return result
        path.pop()
      }
      return null
    }
    const cycle = dfs(dep.id)
    if (cycle) return cycle
  }
  return null
}

const BLOCK_PREFIX = '[auto-block] '

export function formatBlockedNote(blockedBy: string[]): string {
  return `${BLOCK_PREFIX}Blocked by: ${blockedBy.join(', ')}`
}

export function stripBlockedNote(notes: string | null): string {
  if (!notes) return ''
  return notes.replace(/^\[auto-block\] .*\n?/, '').trim()
}

export function buildBlockedNotes(blockedBy: string[], existingNotes?: string | null): string {
  const blockNote = formatBlockedNote(blockedBy)
  const userNotes = stripBlockedNote(existingNotes ?? null)
  return userNotes ? `${blockNote}\n${userNotes}` : blockNote
}

/**
 * Check whether a task's dependencies are satisfied.
 * Creates a temporary dependency index from the current task list.
 * Returns { shouldBlock: true, blockedBy: [...] } if deps are unsatisfied.
 */
export function checkTaskDependencies(
  taskId: string,
  deps: TaskDependency[],
  logger: Logger,
  listTasks: () => SprintTask[]
): { shouldBlock: boolean; blockedBy: string[] } {
  try {
    const allTasks = listTasks()
    const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    const idx = createDependencyIndex()
    const { satisfied, blockedBy } = idx.areDependenciesSatisfied(taskId, deps, (depId: string) =>
      statusMap.get(depId)
    )
    return { shouldBlock: !satisfied && blockedBy.length > 0, blockedBy }
  } catch (err) {
    logger.warn(`[dependency-service] checkTaskDependencies failed for ${taskId}: ${err}`)
    return { shouldBlock: false, blockedBy: [] }
  }
}
