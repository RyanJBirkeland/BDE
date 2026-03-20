/**
 * Sprint mutation observer — pub/sub for task CRUD events.
 * Extracted from sprint-local.ts to decouple SSE broadcasting
 * and event-store cleanup from handler registration.
 */
import type { SprintTask } from '../../shared/types'

export type SprintMutationEvent = {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}
export type SprintMutationListener = (event: SprintMutationEvent) => void

const listeners: Set<SprintMutationListener> = new Set()

export function onSprintMutation(cb: SprintMutationListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function notifySprintMutation(
  type: SprintMutationEvent['type'],
  task: SprintTask
): void {
  const event = { type, task }
  for (const cb of listeners) {
    try {
      cb(event)
    } catch (err) {
      console.error('[sprint-listeners]', err)
    }
  }
}
