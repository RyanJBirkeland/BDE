import type { SprintTask } from '../../../shared/types'

/**
 * Names of SprintTask fields that can appear in a pending optimistic update.
 * Typing `fields` with the concrete union (not `string`) makes typos a compile
 * error at every producer and lets the merge path assign by key without casts.
 */
export type SprintTaskField = keyof SprintTask

export interface PendingUpdate {
  ts: number
  fields: readonly SprintTaskField[]
}

export type PendingUpdates = Record<string, PendingUpdate>

/**
 * Merge server task data with locally pending fields.
 * Returns the server task with pending fields overlaid from the local version.
 * If the TTL has expired or no local task exists, returns the server task unchanged.
 */
export function mergePendingFields(
  serverTask: SprintTask,
  localTask: SprintTask | undefined,
  pending: PendingUpdate | undefined,
  now: number,
  ttlMs: number
): SprintTask {
  if (!pending || !localTask || now - pending.ts > ttlMs) return serverTask

  const merged: SprintTask = { ...serverTask }
  for (const field of pending.fields) {
    assignField(merged, localTask, field)
  }
  return merged
}

/**
 * Remove expired entries from a pending updates map.
 * Returns a new map with only entries whose timestamp is within the TTL window.
 */
export function expirePendingUpdates(updates: PendingUpdates, ttlMs: number): PendingUpdates {
  const now = Date.now()
  const result: PendingUpdates = {}
  for (const [id, pending] of Object.entries(updates)) {
    if (now - pending.ts <= ttlMs) {
      result[id] = pending
    }
  }
  return result
}

/**
 * Add or update a pending operation entry for a task.
 * Merges new fields with any existing pending fields for the same task.
 */
export function trackPendingOperation(
  updates: PendingUpdates,
  taskId: string,
  fields: readonly SprintTaskField[],
  ts: number
): PendingUpdates {
  const existing = updates[taskId]
  const existingFields = existing?.fields ?? []
  const mergedFields = Array.from(new Set<SprintTaskField>([...existingFields, ...fields]))
  return {
    ...updates,
    [taskId]: { ts, fields: mergedFields }
  }
}

/**
 * Copy a single typed field from `source` to `target`. Extracted so the merge
 * loop reads as prose — "for each field, assign that field from local to merged" —
 * instead of exposing a generic-key indexing idiom at the call site.
 */
function assignField<K extends SprintTaskField>(
  target: SprintTask,
  source: SprintTask,
  field: K
): void {
  target[field] = source[field]
}
