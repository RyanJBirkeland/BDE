import type { DependencyIndex } from '../services/dependency-service'
import type { TaskDependency } from '../../shared/types'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { isTerminal } from '../../shared/task-state-machine'

export type DepsFingerprint = Map<string, { deps: TaskDependency[] | null; hash: string }>

/**
 * F-t1-sysprof-1: Compute a stable fingerprint of a dependency array.
 * The fingerprint is sort-order-independent (sorted by id) so two equivalent
 * arrays produce the same hash regardless of insertion order.
 *
 * Format: "id1:type1:cond1|id2:type2:cond2|..." with entries sorted by id.
 * The pipe and colon separators are safe because TaskDependency.id is a
 * task UUID and type/condition are enum strings without those characters.
 */
export function computeDepsFingerprint(deps: TaskDependency[] | null): string {
  if (!deps || deps.length === 0) return ''
  return deps
    .map((d) => `${d.id}:${d.type}:${d.condition ?? ''}`)
    .sort()
    .join('|')
}

/**
 * Incrementally updates the dependency index from the repository.
 *
 * - Removes tasks that have been deleted from both the dep-index and the
 *   fingerprint cache.
 * - Evicts terminal-status tasks from the fingerprint cache (their deps are
 *   frozen; keeping entries just grows the map unboundedly).
 * - Updates the dep-index for tasks whose dependency fingerprint changed.
 *
 * Returns a Map<taskId, status> built from the current task list.
 * On repo error, logs a warning and returns an empty map so the drain loop
 * continues with a stale-but-safe state.
 */
export function refreshDependencyIndex(
  depIndex: DependencyIndex,
  fingerprints: DepsFingerprint,
  repo: ISprintTaskRepository,
  logger: Logger
): Map<string, string> {
  try {
    const allTasks = repo.getTasksWithDependencies()
    const currentTaskIds = new Set(allTasks.map((t) => t.id))

    // Remove deleted tasks from index
    for (const oldId of fingerprints.keys()) {
      if (!currentTaskIds.has(oldId)) {
        depIndex.remove(oldId)
        fingerprints.delete(oldId)
      }
    }

    // Update tasks with changed dependencies.
    // Compare cached fingerprints — avoids re-sorting the
    // unchanged-deps case (the common path for most drain ticks).
    // Evict terminal-status tasks from fingerprints — their deps
    // never change, so keeping fingerprint entries just grows the map forever.
    // Evict on first terminal encounter; dep-index edges stay intact for
    // dependency-satisfaction checks.
    for (const task of allTasks) {
      if (isTerminal(task.status)) {
        // Terminal tasks' deps are frozen — evict from fingerprint cache so
        // the map doesn't grow without bound. The dep-index retains the task's
        // edges for dependency-satisfaction checks.
        fingerprints.delete(task.id)
        continue
      }
      const cached = fingerprints.get(task.id)
      const newDeps = task.depends_on ?? null
      const newHash = computeDepsFingerprint(newDeps)
      if (!cached || cached.hash !== newHash) {
        depIndex.update(task.id, newDeps)
        fingerprints.set(task.id, { deps: newDeps, hash: newHash })
      }
    }

    return new Map(allTasks.map((t) => [t.id, t.status]))
  } catch (err) {
    logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    return new Map()
  }
}
