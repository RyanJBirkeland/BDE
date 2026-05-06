import { describe, it, expect } from 'vitest'
import {
  agentEventSummary,
  buildAgentFeedEntry,
  buildChangeFeedEntry
} from '../usePlActivityFeed'
import type { AgentEvent } from '../../../../../../shared/types'

describe('agentEventSummary', () => {
  it('returns "Agent started" for agent:started', () => {
    const e: AgentEvent = { type: 'agent:started', model: 'claude', timestamp: 0 }
    expect(agentEventSummary(e)).toBe('Agent started')
  })

  it('returns "Agent completed" for agent:completed', () => {
    const e: AgentEvent = {
      type: 'agent:completed',
      exitCode: 0,
      costUsd: 0.1,
      tokensIn: 100,
      tokensOut: 50,
      durationMs: 5000,
      timestamp: 0
    }
    expect(agentEventSummary(e)).toBe('Agent completed')
  })

  it('formats agent:tool_call with $ prefix', () => {
    const e: AgentEvent = {
      type: 'agent:tool_call',
      tool: 'Read',
      summary: 'src/foo.ts',
      timestamp: 0
    }
    expect(agentEventSummary(e)).toBe('$ Read: src/foo.ts')
  })

  it('truncates agent:tool_call at 60 chars', () => {
    const e: AgentEvent = {
      type: 'agent:tool_call',
      tool: 'Bash',
      summary: 'x'.repeat(70),
      timestamp: 0
    }
    expect(agentEventSummary(e).length).toBeLessThanOrEqual(60)
  })

  it('returns error message for agent:error', () => {
    const e: AgentEvent = { type: 'agent:error', message: 'auth failed', timestamp: 0 }
    expect(agentEventSummary(e)).toBe('auth failed')
  })

  it('truncates agent:error message at 80 chars', () => {
    const e: AgentEvent = { type: 'agent:error', message: 'e'.repeat(100), timestamp: 0 }
    expect(agentEventSummary(e).length).toBe(80)
  })
})

describe('buildAgentFeedEntry', () => {
  it('returns null for non-tracked event types', () => {
    const e: AgentEvent = { type: 'agent:text', text: 'hello', timestamp: 0 }
    expect(buildAgentFeedEntry(e, 't1', 'Task 1')).toBeNull()
  })

  it('converts timestamp from ms to ISO string', () => {
    const e: AgentEvent = { type: 'agent:started', model: 'claude', timestamp: 1000 }
    const entry = buildAgentFeedEntry(e, 't1', 'Task 1')
    expect(entry?.timestamp).toBe(new Date(1000).toISOString())
  })

  it('sets taskId and taskTitle correctly', () => {
    const e: AgentEvent = { type: 'agent:started', model: 'claude', timestamp: 0 }
    const entry = buildAgentFeedEntry(e, 't1', 'My Task')
    expect(entry?.taskId).toBe('t1')
    expect(entry?.taskTitle).toBe('My Task')
    expect(entry?.kind).toBe('agent')
  })
})

describe('buildChangeFeedEntry', () => {
  it('maps all fields from a change row', () => {
    const row = {
      id: 1,
      task_id: 't1',
      field: 'status',
      old_value: 'queued',
      new_value: 'active',
      changed_by: 'system',
      changed_at: '2026-01-01T00:00:00.000Z'
    }
    const entry = buildChangeFeedEntry(row, 'My Task')
    expect(entry.kind).toBe('change')
    expect(entry.taskId).toBe('t1')
    expect(entry.taskTitle).toBe('My Task')
    expect(entry.field).toBe('status')
    expect(entry.oldValue).toBe('queued')
    expect(entry.newValue).toBe('active')
    expect(entry.changedBy).toBe('system')
    expect(entry.timestamp).toBe('2026-01-01T00:00:00.000Z')
  })
})
