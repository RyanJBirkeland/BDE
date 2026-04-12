/**
 * Epic (TaskGroup) dependency management service.
 * Mirrors task-level dependency-service.ts for epic-to-epic dependencies.
 */

import type { EpicDependency } from '../../shared/types'
import { TERMINAL_STATUSES, HARD_SATISFIED_STATUSES } from './dependency-service'

// Re-export canonical status sets for epic satisfaction checks
export { TERMINAL_STATUSES, HARD_SATISFIED_STATUSES }

export interface EpicDependencyIndex {
  rebuild(epics: Array<{ id: string; depends_on: EpicDependency[] | null }>): void
  update(epicId: string, deps: EpicDependency[] | null): void
  remove(epicId: string): void
  getDependentEpics(epicId: string): Set<string>
  areEpicDepsSatisfied(
    epicId: string,
    deps: EpicDependency[],
    getEpicStatus: (id: string) => string | undefined,
    getEpicTasks: (id: string) => Array<{ status: string }> | undefined
  ): { satisfied: boolean; blockedBy: string[] }
}

export function createEpicDependencyIndex(): EpicDependencyIndex {
  const reverseMap = new Map<string, Set<string>>()
  const forwardMap = new Map<string, Set<string>>()

  function addEdges(epicId: string, deps: EpicDependency[] | null): void {
    if (!deps || deps.length === 0) {
      forwardMap.delete(epicId)
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
      set.add(epicId)
    }
    forwardMap.set(epicId, depIds)
  }

  function removeEdges(epicId: string): void {
    const oldDeps = forwardMap.get(epicId)
    if (oldDeps) {
      for (const depId of oldDeps) {
        const dependents = reverseMap.get(depId)
        if (dependents) {
          dependents.delete(epicId)
          if (dependents.size === 0) {
            reverseMap.delete(depId)
          }
        }
      }
    }
    forwardMap.delete(epicId)
  }

  return {
    rebuild(epics) {
      reverseMap.clear()
      forwardMap.clear()
      for (const epic of epics) addEdges(epic.id, epic.depends_on)
    },
    update(epicId, deps) {
      removeEdges(epicId)
      addEdges(epicId, deps)
    },
    remove(epicId) {
      removeEdges(epicId)
      reverseMap.delete(epicId)
    },
    getDependentEpics(epicId) {
      return reverseMap.get(epicId) ?? new Set()
    },
    areEpicDepsSatisfied(_epicId, deps, getEpicStatus, getEpicTasks) {
      if (deps.length === 0) return { satisfied: true, blockedBy: [] }
      const blockedBy: string[] = []

      for (const dep of deps) {
        const epicStatus = getEpicStatus(dep.id)
        // Deleted epic = satisfied (matches task-level convention)
        if (epicStatus === undefined) continue

        const tasks = getEpicTasks(dep.id) ?? []

        if (dep.condition === 'on_success') {
          // Vacuous truth: empty epic is satisfied
          if (tasks.length === 0) continue
          // All tasks must be 'done'
          if (!tasks.every((t) => HARD_SATISFIED_STATUSES.has(t.status))) {
            blockedBy.push(dep.id)
          }
        } else if (dep.condition === 'always') {
          // Vacuous truth: empty epic is satisfied
          if (tasks.length === 0) continue
          // All tasks must be terminal (done/failed/error/cancelled)
          if (!tasks.every((t) => TERMINAL_STATUSES.has(t.status))) {
            blockedBy.push(dep.id)
          }
        } else if (dep.condition === 'manual') {
          // Manual: check epic-level status, ignore task statuses
          // Zero-task epic is NOT satisfied for manual (explicit user action required)
          if (epicStatus !== 'completed') {
            blockedBy.push(dep.id)
          }
        }
      }

      return { satisfied: blockedBy.length === 0, blockedBy }
    }
  }
}

export function detectEpicCycle(
  epicId: string,
  proposedDeps: EpicDependency[],
  getDepsForEpic: (id: string) => EpicDependency[] | null
): string[] | null {
  // Self-reference check
  for (const dep of proposedDeps) {
    if (dep.id === epicId) return [epicId, epicId]
  }

  // DFS from each proposed edge
  for (const dep of proposedDeps) {
    const visited = new Set<string>()
    const path: string[] = [epicId, dep.id]

    function dfs(current: string): string[] | null {
      if (current === epicId) return [...path]
      if (visited.has(current)) return null
      visited.add(current)

      const deps = getDepsForEpic(current)
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
