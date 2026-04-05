import type { TaskDependency } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])
const HARD_SATISFIED_STATUSES = new Set(['done'])
const FAILURE_STATUSES = new Set(['failed', 'error', 'cancelled'])

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
