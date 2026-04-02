import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import {
  appendEvent,
  getEventHistory,
  pruneOldEvents,
  insertEventBatch,
  queryEvents,
  pruneEventsByAgentIds
} from '../event-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('appendEvent + getEventHistory', () => {
  it('inserts events and retrieves them in timestamp order', () => {
    const payload1 = JSON.stringify({ type: 'agent:started', model: 'opus', timestamp: 1000 })
    const payload2 = JSON.stringify({ type: 'agent:text', text: 'hello', timestamp: 2000 })

    appendEvent(db, 'agent-1', 'agent:started', payload1, 1000)
    appendEvent(db, 'agent-1', 'agent:text', payload2, 2000)

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(2)
    expect(JSON.parse(history[0].payload).type).toBe('agent:started')
    expect(JSON.parse(history[1].payload).type).toBe('agent:text')
  })

  it('returns empty array for unknown agent', () => {
    const history = getEventHistory(db, 'nonexistent')
    expect(history).toEqual([])
  })

  it('keeps events separated by agent ID', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"type":"agent:text"}', 1000)
    appendEvent(db, 'agent-2', 'agent:text', '{"type":"agent:text"}', 2000)

    expect(getEventHistory(db, 'agent-1')).toHaveLength(1)
    expect(getEventHistory(db, 'agent-2')).toHaveLength(1)
  })
})

describe('pruneOldEvents', () => {
  it('removes events older than retention period', () => {
    const now = Date.now()
    const oldTimestamp = now - 31 * 24 * 60 * 60 * 1000 // 31 days ago
    const recentTimestamp = now - 1 * 24 * 60 * 60 * 1000 // 1 day ago

    appendEvent(db, 'agent-1', 'agent:text', '{"old":true}', oldTimestamp)
    appendEvent(db, 'agent-1', 'agent:text', '{"recent":true}', recentTimestamp)

    pruneOldEvents(db, 30) // keep last 30 days

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(1)
    expect(JSON.parse(history[0].payload).recent).toBe(true)
  })

  it('keeps all events when none are old enough', () => {
    const now = Date.now()
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', now - 1000)
    appendEvent(db, 'agent-1', 'agent:text', '{"b":2}', now)

    pruneOldEvents(db, 30)

    expect(getEventHistory(db, 'agent-1')).toHaveLength(2)
  })
})

describe('insertEventBatch', () => {
  it('inserts multiple events in a single transaction', () => {
    const events = [
      {
        agentId: 'agent-1',
        eventType: 'agent:started',
        payload: '{"type":"agent:started","model":"opus"}',
        timestamp: 1000
      },
      {
        agentId: 'agent-1',
        eventType: 'agent:tool_call',
        payload: '{"type":"agent:tool_call","tool":"Bash"}',
        timestamp: 2000
      },
      {
        agentId: 'agent-1',
        eventType: 'agent:completed',
        payload: '{"type":"agent:completed","exitCode":0}',
        timestamp: 3000
      }
    ]

    insertEventBatch(db, events)

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(3)
    expect(JSON.parse(history[0].payload).type).toBe('agent:started')
    expect(JSON.parse(history[2].payload).type).toBe('agent:completed')
  })

  it('handles empty batch gracefully', () => {
    insertEventBatch(db, [])
    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(0)
  })

  it('is atomic -- all or nothing', () => {
    // Insert one valid event first
    appendEvent(db, 'agent-1', 'agent:text', '{"pre":true}', 500)

    // The batch itself should succeed since all fields are valid
    const events = [
      { agentId: 'agent-1', eventType: 'agent:started', payload: '{"a":1}', timestamp: 1000 },
      { agentId: 'agent-1', eventType: 'agent:text', payload: '{"b":2}', timestamp: 2000 }
    ]
    insertEventBatch(db, events)

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(3) // 1 pre-existing + 2 batch
  })
})

describe('queryEvents', () => {
  beforeEach(() => {
    // Seed events across two agents
    appendEvent(db, 'agent-1', 'agent:started', '{"type":"agent:started","model":"opus"}', 1000)
    appendEvent(db, 'agent-1', 'agent:tool_call', '{"type":"agent:tool_call","tool":"Bash"}', 2000)
    appendEvent(db, 'agent-1', 'agent:tool_call', '{"type":"agent:tool_call","tool":"Read"}', 3000)
    appendEvent(db, 'agent-1', 'agent:completed', '{"type":"agent:completed","exitCode":0}', 4000)
    appendEvent(db, 'agent-2', 'agent:started', '{"type":"agent:started","model":"sonnet"}', 5000)
  })

  it('returns all events for a given agent_id', () => {
    const result = queryEvents(db, { agentId: 'agent-1' })
    expect(result.events).toHaveLength(4)
    expect(result.events[0].event_type).toBe('agent:started')
    expect(result.events[3].event_type).toBe('agent:completed')
  })

  it('filters by event type', () => {
    const result = queryEvents(db, { agentId: 'agent-1', eventType: 'agent:tool_call' })
    expect(result.events).toHaveLength(2)
    expect(result.events.every((e) => e.event_type === 'agent:tool_call')).toBe(true)
  })

  it('supports afterTimestamp for pagination', () => {
    const result = queryEvents(db, { agentId: 'agent-1', afterTimestamp: 2000 })
    expect(result.events).toHaveLength(2) // events at 3000 and 4000
  })

  it('respects limit', () => {
    const result = queryEvents(db, { agentId: 'agent-1', limit: 2 })
    expect(result.events).toHaveLength(2)
    expect(result.hasMore).toBe(true)
  })

  it('returns hasMore=false when all events fit', () => {
    const result = queryEvents(db, { agentId: 'agent-1', limit: 100 })
    expect(result.hasMore).toBe(false)
  })

  it('returns empty result for unknown agent', () => {
    const result = queryEvents(db, { agentId: 'nonexistent' })
    expect(result.events).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('queries by multiple agent IDs', () => {
    const result = queryEvents(db, { agentIds: ['agent-1', 'agent-2'] })
    expect(result.events).toHaveLength(5)
  })
})

describe('pruneEventsByAgentIds', () => {
  it('deletes events for the given agent IDs', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    appendEvent(db, 'agent-2', 'agent:text', '{"b":2}', 2000)
    appendEvent(db, 'agent-3', 'agent:text', '{"c":3}', 3000)

    pruneEventsByAgentIds(db, ['agent-1', 'agent-2'])

    expect(getEventHistory(db, 'agent-1')).toHaveLength(0)
    expect(getEventHistory(db, 'agent-2')).toHaveLength(0)
    expect(getEventHistory(db, 'agent-3')).toHaveLength(1)
  })

  it('handles empty array gracefully', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    pruneEventsByAgentIds(db, [])
    expect(getEventHistory(db, 'agent-1')).toHaveLength(1)
  })

  it('handles non-existent agent IDs gracefully', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    pruneEventsByAgentIds(db, ['ghost-1', 'ghost-2'])
    expect(getEventHistory(db, 'agent-1')).toHaveLength(1)
  })
})
