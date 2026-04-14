import type { SprintTask } from '../../../shared/types'

export interface PendingUpdate {
  ts: number
  fields: string[]
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

  const merged = { ...serverTask } as unknown as Record<string, unknown>
  for (const field of pending.fields) {
    merged[field] = (localTask as unknown as Record<string, unknown>)[field]
  }
  return merged as unknown as SprintTask
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
  fields: string[],
  ts: number
): PendingUpdates {
  const existing = updates[taskId]
  const existingFields = existing?.fields ?? []
  const mergedFields = [...new Set([...existingFields, ...fields])]
  return {
    ...updates,
    [taskId]: { ts, fields: mergedFields }
  }
}
