import type { DependencyIndex } from '../services/dependency-service'
import type { TaskDependency } from '../../shared/types'
import type { Logger } from '../logger'
import { isTerminal, isTaskStatus } from '../../shared/task-state-machine'

export type DepsFingerprint = Map<string, { deps: TaskDependency[] | null; hash: string }>

/**
 * Stable summary of the full fingerprint map used to detect global changes.
 * Joining all task-id/hash pairs lets us skip the DB read entirely when
 * nothing has changed and no tasks are dirty.
 */
function computeGlobalFingerprintHash(fingerprints: DepsFingerprint): string {
  const parts: string[] = []
  for (const [id, entry] of fingerprints) {
    parts.push(`${id}=${entry.hash}`)
  }
  // Sort so insertion order doesn't matter.
  return parts.sort().join('|')
}

/**
 * Per-fingerprint-map cache of the last global hash seen.
 * WeakMap keyed on the `DepsFingerprint` instance so each drain-loop instance
 * gets its own cache without sharing state across tests or instances.
 */
const lastGlobalHash = new WeakMap<DepsFingerprint, string>()

/**
 * The minimum repository surface that `refreshDependencyIndex` needs.
 * Callers holding a full `IAgentTaskRepository` satisfy this structurally;
 * callers that only have `getTasksWithDependencies` can pass a plain object
 * without a double-cast.
 */
export interface DependencyTaskReader {
  getTasksWithDependencies(
    hint?: Set<string>
  ): Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
}

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
 * When `dirtyTaskIds` is provided, the dep-index update step skips tasks not
 * in the set unless their fingerprint differs from the cached value — the
 * fingerprint comparison is the authoritative change check, the dirty set is
 * a hint that lets us skip the comparison entirely for known-stable tasks.
 * Deletion sweep and terminal eviction always run over the full set so a
 * caller-supplied dirty hint can never leak stale fingerprints.
 *
 * Returns a Map<taskId, status> built from the current task list.
 * On repo error, logs a warning and returns an empty map so the drain loop
 * continues with a stale-but-safe state.
 */
export function refreshDependencyIndex(
  depIndex: DependencyIndex,
  fingerprints: DepsFingerprint,
  repo: DependencyTaskReader,
  logger: Logger,
  dirtyTaskIds?: Set<string>
): Map<string, string> {
  // Skip the DB read entirely when the caller signals an empty dirty set AND
  // the global fingerprint hasn't changed since the last full scan. This is the
  // common path on quiet drain ticks where no tasks were claimed or mutated.
  if (dirtyTaskIds !== undefined && dirtyTaskIds.size === 0) {
    const currentHash = computeGlobalFingerprintHash(fingerprints)
    const knownHash = lastGlobalHash.get(fingerprints)
    if (currentHash === knownHash) {
      return new Map()
    }
  }

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
      // Raw DB row provides `status: string`; skip unknown values defensively.
      if (isTaskStatus(task.status) && isTerminal(task.status)) {
        // Terminal tasks' deps are frozen — evict from fingerprint cache so
        // the map doesn't grow without bound. The dep-index retains the task's
        // edges for dependency-satisfaction checks.
        fingerprints.delete(task.id)
        continue
      }
      const cached = fingerprints.get(task.id)
      // When the caller flags a dirty set, tasks outside it whose fingerprint
      // is already cached are presumed stable and skipped — the cached
      // fingerprint stays authoritative until something dirties it.
      if (dirtyTaskIds && cached && !dirtyTaskIds.has(task.id)) {
        continue
      }
      const newDeps = task.depends_on ?? null
      const newHash = computeDepsFingerprint(newDeps)
      if (!cached || cached.hash !== newHash) {
        depIndex.update(task.id, newDeps)
        fingerprints.set(task.id, { deps: newDeps, hash: newHash })
      }
    }

    const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))

    // Compute the post-update hash exactly once and cache it for the next clean tick.
    // Computing it here (after all fingerprint mutations are complete) means the
    // dirty-path also pays at most one hash computation per invocation.
    const postUpdateHash = computeGlobalFingerprintHash(fingerprints)
    lastGlobalHash.set(fingerprints, postUpdateHash)

    return statusMap
  } catch (err) {
    logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    return new Map()
  }
}
