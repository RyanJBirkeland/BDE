/**
 * Sprint mutation observer — pub/sub for task CRUD events.
 * Extracted from sprint-local.ts to decouple SSE broadcasting
 * and event-store cleanup from handler registration.
 */
import type { SprintTask } from '../../shared/types'
import { sseBroadcaster } from '../queue-api/router'
import { createLogger } from '../logger'

const logger = createLogger('sprint-listeners')

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

export function notifySprintMutation(type: SprintMutationEvent['type'], task: SprintTask): void {
  const event = { type, task }
  for (const cb of listeners) {
    try {
      cb(event)
    } catch (err) {
      logger.error(`${err}`)
    }
  }

  sseBroadcaster.broadcast('task:updated', { id: task.id, status: task.status })
  if (task.status === 'queued') {
    sseBroadcaster.broadcast('task:queued', {
      id: task.id,
      title: task.title,
      priority: task.priority
    })
  }
}
