import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the sprint-listeners module before importing event-store
vi.mock('../handlers/sprint-listeners', () => ({
  onSprintMutation: vi.fn().mockReturnValue(() => {}),
}))

import {
  appendEvents,
  getEvents,
  clearTask,
  MAX_EVENTS_PER_TASK,
} from '../queue-api/event-store'
import type { TaskOutputEvent } from '../../shared/queue-api-contract'

function makeEvent(partial: Partial<TaskOutputEvent> = {}): TaskOutputEvent {
  return {
    taskId: 'task-1',
    timestamp: new Date().toISOString(),
    type: 'agent:tool_call',
    ...partial,
  }
}

describe('event-store', () => {
  beforeEach(() => {
    clearTask('task-1')
    clearTask('task-2')
  })

  it('returns empty array for unknown taskId', () => {
    expect(getEvents('nonexistent')).toEqual([])
  })

  it('appends and retrieves events', () => {
    const events = [makeEvent(), makeEvent({ type: 'agent:thinking' })]
    appendEvents('task-1', events)
    const stored = getEvents('task-1')
    expect(stored).toHaveLength(2)
    expect(stored[0].type).toBe('agent:tool_call')
    expect(stored[1].type).toBe('agent:thinking')
  })

  it('appends events incrementally', () => {
    appendEvents('task-1', [makeEvent()])
    appendEvents('task-1', [makeEvent({ type: 'agent:completed' })])
    expect(getEvents('task-1')).toHaveLength(2)
  })

  it('clearTask removes all events for a task', () => {
    appendEvents('task-1', [makeEvent()])
    expect(getEvents('task-1')).toHaveLength(1)
    clearTask('task-1')
    expect(getEvents('task-1')).toEqual([])
  })

  it('caps events at MAX_EVENTS_PER_TASK, keeping latest', () => {
    const events: TaskOutputEvent[] = []
    for (let i = 0; i < MAX_EVENTS_PER_TASK + 50; i++) {
      events.push(makeEvent({ timestamp: `2026-01-01T00:00:${String(i).padStart(4, '0')}Z` }))
    }
    appendEvents('task-1', events)
    const stored = getEvents('task-1')
    expect(stored).toHaveLength(MAX_EVENTS_PER_TASK)
    // Should keep the latest events (dropped the first 50)
    expect(stored[0].timestamp).toBe('2026-01-01T00:00:0050Z')
  })

  it('isolates events between tasks', () => {
    appendEvents('task-1', [makeEvent({ taskId: 'task-1' })])
    appendEvents('task-2', [makeEvent({ taskId: 'task-2' }), makeEvent({ taskId: 'task-2' })])
    expect(getEvents('task-1')).toHaveLength(1)
    expect(getEvents('task-2')).toHaveLength(2)
  })
})
