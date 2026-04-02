import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSprintEvents } from '../sprintEvents'
import type { AgentEvent } from '../../../../shared/types'
import type { TaskOutputEvent } from '../../../../shared/queue-api-contract'

const initialState = {
  taskEvents: {},
  latestEvents: {}
}

beforeEach(() => {
  useSprintEvents.setState(initialState)
  vi.clearAllMocks()
})

function makeAgentEvent(text = 'hello'): AgentEvent {
  return {
    type: 'agent:text',
    text,
    timestamp: Date.now()
  }
}

function makeTaskOutputEvent(taskId: string, type = 'agent:started'): TaskOutputEvent {
  return {
    taskId,
    timestamp: new Date().toISOString(),
    type
  }
}

// --- initTaskOutputListener ---

describe('initTaskOutputListener', () => {
  it('calls window.api.agentEvents.onEvent to subscribe', () => {
    useSprintEvents.getState().initTaskOutputListener()
    expect(window.api.agentEvents.onEvent).toHaveBeenCalledOnce()
  })

  it('returns a cleanup function that calls the unsubscribe fn', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.agentEvents.onEvent).mockReturnValue(unsubscribe)

    const cleanup = useSprintEvents.getState().initTaskOutputListener()
    cleanup()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('returns a cleanup function that is safe when onEvent returns undefined', () => {
    vi.mocked(window.api.agentEvents.onEvent).mockReturnValue(undefined as unknown as () => void)

    const cleanup = useSprintEvents.getState().initTaskOutputListener()
    // should not throw
    expect(() => cleanup()).not.toThrow()
  })

  it('appends an event to the correct agent bucket when an event arrives', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const event = makeAgentEvent('first')
    captured!({ agentId: 'agent-1', event })

    const { taskEvents, latestEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-1']).toHaveLength(1)
    expect(latestEvents['agent-1']).toBe(event)
  })

  it('accumulates multiple events for the same agent', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    captured!({ agentId: 'agent-1', event: makeAgentEvent('e1') })
    captured!({ agentId: 'agent-1', event: makeAgentEvent('e2') })
    captured!({ agentId: 'agent-1', event: makeAgentEvent('e3') })

    expect(useSprintEvents.getState().taskEvents['agent-1']).toHaveLength(3)
  })

  it('keeps events isolated between different agents', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    captured!({ agentId: 'agent-x', event: makeAgentEvent('ex') })
    captured!({ agentId: 'agent-y', event: makeAgentEvent('ey') })

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-x']).toHaveLength(1)
    expect(taskEvents['agent-y']).toHaveLength(1)
  })

  it('updates latestEvents to the most recently received event', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const first = makeAgentEvent('first')
    const second = makeAgentEvent('second')
    captured!({ agentId: 'agent-1', event: first })
    captured!({ agentId: 'agent-1', event: second })

    expect(useSprintEvents.getState().latestEvents['agent-1']).toBe(second)
  })

  it('preserves existing events from other agents when a new event arrives', () => {
    useSprintEvents.setState({
      taskEvents: { 'agent-existing': [makeAgentEvent('old')] },
      latestEvents: {}
    })

    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()
    captured!({ agentId: 'agent-new', event: makeAgentEvent('new') })

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-existing']).toHaveLength(1)
    expect(taskEvents['agent-new']).toHaveLength(1)
  })

  it('caps events at MAX_EVENTS_PER_AGENT (500) to prevent memory leaks', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    // Pre-fill with 500 events via setState
    const existing = Array.from({ length: 500 }, (_, i) => makeAgentEvent(`e${i}`))
    useSprintEvents.setState({ taskEvents: { 'agent-1': existing }, latestEvents: {} })

    // Push one more — should slice to keep only the last 500
    captured!({ agentId: 'agent-1', event: makeAgentEvent('overflow') })

    const events = useSprintEvents.getState().taskEvents['agent-1']
    expect(events).toHaveLength(500)
    // Last event should be the overflow one
    expect((events[499] as { type: string; text: string }).text).toBe('overflow')
  })

  it('works with TaskOutputEvent shapes as well as AgentEvent shapes', () => {
    let captured: ((payload: { agentId: string; event: TaskOutputEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      captured = cb as unknown as typeof captured
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const event = makeTaskOutputEvent('task-123', 'agent:started')
    captured!({ agentId: 'agent-2', event })

    const { taskEvents, latestEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-2']).toHaveLength(1)
    expect(latestEvents['agent-2']).toBe(event)
  })
})

// --- clearTaskEvents ---

describe('clearTaskEvents', () => {
  it('removes events and latest event for the given agent', () => {
    useSprintEvents.setState({
      taskEvents: {
        'agent-a': [makeAgentEvent('a1'), makeAgentEvent('a2')],
        'agent-b': [makeAgentEvent('b1')]
      },
      latestEvents: {
        'agent-a': makeAgentEvent('a2'),
        'agent-b': makeAgentEvent('b1')
      }
    })

    useSprintEvents.getState().clearTaskEvents('agent-a')

    const { taskEvents, latestEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-a']).toBeUndefined()
    expect(latestEvents['agent-a']).toBeUndefined()
  })

  it('leaves other agents untouched', () => {
    useSprintEvents.setState({
      taskEvents: {
        'agent-a': [makeAgentEvent('a1')],
        'agent-b': [makeAgentEvent('b1')]
      },
      latestEvents: {
        'agent-a': makeAgentEvent('a1'),
        'agent-b': makeAgentEvent('b1')
      }
    })

    useSprintEvents.getState().clearTaskEvents('agent-a')

    const { taskEvents, latestEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-b']).toHaveLength(1)
    expect(latestEvents['agent-b']).toBeDefined()
  })

  it('is a no-op when the agent id does not exist', () => {
    useSprintEvents.setState({
      taskEvents: { 'agent-a': [makeAgentEvent('a1')] },
      latestEvents: { 'agent-a': makeAgentEvent('a1') }
    })

    // should not throw
    useSprintEvents.getState().clearTaskEvents('nonexistent')

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-a']).toHaveLength(1)
  })

  it('handles clearing from an empty store without throwing', () => {
    expect(() => useSprintEvents.getState().clearTaskEvents('any-id')).not.toThrow()
    expect(useSprintEvents.getState().taskEvents).toEqual({})
    expect(useSprintEvents.getState().latestEvents).toEqual({})
  })
})

// --- initial state ---

describe('initial state', () => {
  it('has empty taskEvents', () => {
    expect(useSprintEvents.getState().taskEvents).toEqual({})
  })

  it('has empty latestEvents', () => {
    expect(useSprintEvents.getState().latestEvents).toEqual({})
  })
})
