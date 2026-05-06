import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  agentEventSummary,
  buildAgentFeedEntry,
  buildChangeFeedEntry,
  parseChangeRows,
  parseAgentEvents,
  usePlActivityFeed
} from '../usePlActivityFeed'
import type { AgentEvent, SprintTask } from '../../../../../../shared/types'

vi.mock('../../../../../services/agents', () => ({
  subscribeToAgentEvents: vi.fn(() => vi.fn()),
  getAgentEventHistory: vi.fn().mockResolvedValue([])
}))

import { subscribeToAgentEvents, getAgentEventHistory } from '../../../../../services/agents'

function makeTask(id: string, title = `Task ${id}`): SprintTask {
  return { id, title } as SprintTask
}

function makeValidChangeRow(taskId: string, field = 'status') {
  return {
    id: 1,
    task_id: taskId,
    field,
    old_value: null,
    new_value: 'active',
    changed_by: 'system',
    changed_at: new Date(Date.now() - 1000).toISOString()
  }
}

function setupWindowApi(options: {
  getChanges?: () => Promise<unknown>
} = {}) {
  ;(window as Record<string, unknown>).api = {
    sprint: {
      getChanges: options.getChanges ?? vi.fn().mockResolvedValue([])
    }
  }
}

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

describe('parseChangeRows', () => {
  it('returns empty array for non-array input', () => {
    expect(parseChangeRows(null)).toEqual([])
    expect(parseChangeRows('bad')).toEqual([])
    expect(parseChangeRows(42)).toEqual([])
  })

  it('filters out rows missing required string fields', () => {
    const malformed = { id: 1, task_id: 't1' } // missing field, changed_by, changed_at
    expect(parseChangeRows([malformed])).toEqual([])
  })

  it('accepts a well-formed row', () => {
    const valid = {
      id: 1,
      task_id: 't1',
      field: 'status',
      old_value: null,
      new_value: 'active',
      changed_by: 'system',
      changed_at: '2026-01-01T00:00:00.000Z'
    }
    expect(parseChangeRows([valid])).toHaveLength(1)
  })

  it('keeps valid rows and drops invalid ones in a mixed array', () => {
    const valid = {
      id: 1,
      task_id: 't1',
      field: 'status',
      old_value: null,
      new_value: 'done',
      changed_by: 'system',
      changed_at: '2026-01-01T00:00:00.000Z'
    }
    const invalid = { id: 2, task_id: 't2' }
    expect(parseChangeRows([valid, invalid])).toHaveLength(1)
  })
})

describe('parseAgentEvents', () => {
  it('returns empty array for non-array input', () => {
    expect(parseAgentEvents(null)).toEqual([])
    expect(parseAgentEvents('bad')).toEqual([])
  })

  it('filters out rows missing required fields', () => {
    const missingType = { timestamp: 1000 }
    const missingTimestamp = { type: 'agent:started' }
    const unknownType = { type: 'agent:unknown', timestamp: 1000 }
    expect(parseAgentEvents([missingType, missingTimestamp, unknownType])).toEqual([])
  })

  it('accepts a well-formed agent event', () => {
    const valid = { type: 'agent:started', model: 'claude', timestamp: 1000 }
    expect(parseAgentEvents([valid])).toHaveLength(1)
  })
})

describe('usePlActivityFeed — N+1 dep array fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupWindowApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not refetch when task content changes but IDs stay the same', async () => {
    const getChangesMock = vi.fn().mockResolvedValue([])
    setupWindowApi({ getChanges: getChangesMock })

    const task = makeTask('t1', 'Original title')
    const { rerender } = renderHook(({ tasks }: { tasks: SprintTask[] }) =>
      usePlActivityFeed(tasks), { initialProps: { tasks: [task] } }
    )

    // Wait for initial fetch
    await act(async () => {})
    const callCountAfterMount = getChangesMock.mock.calls.length

    // Rerender with same ID but different title — should NOT trigger a new fetch
    rerender({ tasks: [makeTask('t1', 'Updated title')] })
    await act(async () => {})

    expect(getChangesMock.mock.calls.length).toBe(callCountAfterMount)
  })

  it('refetches when task IDs change', async () => {
    const getChangesMock = vi.fn().mockResolvedValue([])
    setupWindowApi({ getChanges: getChangesMock })

    const { rerender } = renderHook(({ tasks }: { tasks: SprintTask[] }) =>
      usePlActivityFeed(tasks), { initialProps: { tasks: [makeTask('t1')] } }
    )

    await act(async () => {})
    const callCountAfterMount = getChangesMock.mock.calls.length

    // Rerender with a different task ID — should trigger a new fetch
    rerender({ tasks: [makeTask('t2')] })
    await act(async () => {})

    expect(getChangesMock.mock.calls.length).toBeGreaterThan(callCountAfterMount)
  })
})

describe('usePlActivityFeed — live event insertion order', () => {
  let capturedEventHandler: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedEventHandler = null

    vi.mocked(subscribeToAgentEvents).mockImplementation((handler) => {
      capturedEventHandler = handler
      return vi.fn()
    })

    setupWindowApi({
      getChanges: vi.fn().mockResolvedValue([makeValidChangeRow('t1')])
    })
    vi.mocked(getAgentEventHistory).mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts live events at the head, keeping newest-first order', async () => {
    const { result } = renderHook(() => usePlActivityFeed([makeTask('t1')]))

    // Wait for initial fetch to populate one historical entry
    await act(async () => {})
    expect(result.current.entries).toHaveLength(1)

    // Emit a live event — it should appear at the head
    const liveEvent: AgentEvent = { type: 'agent:started', model: 'claude', timestamp: Date.now() }
    act(() => {
      capturedEventHandler?.({ agentId: 't1', event: liveEvent })
    })

    expect(result.current.entries[0].kind).toBe('agent')
    expect(result.current.entries).toHaveLength(2)
  })
})

describe('usePlActivityFeed hook — integration', () => {
  let capturedEventHandler: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
  let capturedUnsub: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    capturedEventHandler = null
    capturedUnsub = vi.fn()

    vi.mocked(subscribeToAgentEvents).mockImplementation((handler) => {
      capturedEventHandler = handler
      return capturedUnsub
    })

    setupWindowApi({ getChanges: vi.fn().mockResolvedValue([]) })
    vi.mocked(getAgentEventHistory).mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('empty tasks array returns { entries: [], loading: false, error: null } without any IPC calls', () => {
    const getChangesMock = vi.fn().mockResolvedValue([])
    setupWindowApi({ getChanges: getChangesMock })

    const { result } = renderHook(() => usePlActivityFeed([]))

    expect(result.current.entries).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getChangesMock).not.toHaveBeenCalled()
    expect(getAgentEventHistory).not.toHaveBeenCalled()
  })

  it('non-empty tasks fetches changes and history, populating entries on resolve', async () => {
    const changeRow = makeValidChangeRow('t1')
    setupWindowApi({ getChanges: vi.fn().mockResolvedValue([changeRow]) })
    vi.mocked(getAgentEventHistory).mockResolvedValue([
      { type: 'agent:started', model: 'claude', timestamp: Date.now() }
    ])

    const { result } = renderHook(() => usePlActivityFeed([makeTask('t1')]))

    await act(async () => {})

    expect(result.current.entries.length).toBeGreaterThan(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('IPC failure sets error state and leaves entries empty', async () => {
    setupWindowApi({ getChanges: vi.fn().mockRejectedValue(new Error('IPC timeout')) })

    const { result } = renderHook(() => usePlActivityFeed([makeTask('t1')]))

    await act(async () => {})

    expect(result.current.error).toBe('IPC timeout')
    expect(result.current.entries).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('string rejection shows the string in error, not "undefined"', async () => {
    setupWindowApi({ getChanges: vi.fn().mockRejectedValue('plain string error') })

    const { result } = renderHook(() => usePlActivityFeed([makeTask('t1')]))

    await act(async () => {})

    expect(result.current.error).toBe('plain string error')
    expect(result.current.error).not.toBe('undefined')
  })

  it('live subscription adds an entry at the head and entries stay newest-first', async () => {
    const historicalRow = makeValidChangeRow('t1')
    setupWindowApi({ getChanges: vi.fn().mockResolvedValue([historicalRow]) })

    const { result } = renderHook(() => usePlActivityFeed([makeTask('t1')]))
    await act(async () => {})
    const beforeCount = result.current.entries.length

    const liveEvent: AgentEvent = { type: 'agent:started', model: 'claude', timestamp: Date.now() }
    act(() => {
      capturedEventHandler?.({ agentId: 't1', event: liveEvent })
    })

    expect(result.current.entries).toHaveLength(beforeCount + 1)
    expect(result.current.entries[0].kind).toBe('agent')
  })

  it('cleans up the subscription on unmount', () => {
    const { unmount } = renderHook(() => usePlActivityFeed([makeTask('t1')]))
    const callsBefore = capturedUnsub.mock.calls.length
    unmount()
    // At least one additional unsub call must happen when the component unmounts
    expect(capturedUnsub.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})
