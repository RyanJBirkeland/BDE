/**
 * In-memory event storage for task output streaming.
 * Events are transient — cleared when tasks reach terminal status.
 */
import type { TaskOutputEvent } from '../../shared/queue-api-contract'
import { onSprintMutation } from '../handlers/sprint-listeners'

const eventStore = new Map<string, TaskOutputEvent[]>()
export const MAX_EVENTS_PER_TASK = 500

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'])

export function appendEvents(taskId: string, events: TaskOutputEvent[]): void {
  const existing = eventStore.get(taskId) ?? []
  existing.push(...events)
  if (existing.length > MAX_EVENTS_PER_TASK) {
    eventStore.set(taskId, existing.slice(-MAX_EVENTS_PER_TASK))
  } else {
    eventStore.set(taskId, existing)
  }
}

export function getEvents(taskId: string): TaskOutputEvent[] {
  return eventStore.get(taskId) ?? []
}

export function clearTask(taskId: string): void {
  eventStore.delete(taskId)
}

/** Hook into sprint mutations to auto-clear events for terminal tasks. */
export function initEventStoreCleanup(): () => void {
  return onSprintMutation(({ type, task }) => {
    if (type === 'updated' && TERMINAL_STATUSES.has(task.status)) {
      clearTask(task.id)
    }
  })
}
