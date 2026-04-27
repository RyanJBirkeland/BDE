import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSprintEvents, selectLatestEvent, readAgentEvents, MAX_EVENTS_PER_AGENT } from '../sprintEvents'
import { createRingBuffer, pushToRingBuffer } from '../../lib/ringBuffer'
import type { AgentEvent } from '../../../../shared/types'
import type { TaskOutputEvent } from '../../../../shared/types'
import { nowIso } from '../../../../shared/time'

const initialState = {
  taskEvents: {}
}

beforeEach(() => {
  useSprintEvents.getState().destroy() // reset module-level guard
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
    timestamp: nowIso(),
    type
  }
}

/** Helper: create a RingBuffer pre-filled with `events`. */
function makeRingBuffer(events: AgentEvent[]) {
  const buf = createRingBuffer<AgentEvent>(MAX_EVENTS_PER_AGENT)
  events.forEach((e) => pushToRingBuffer(buf, e))
  return buf
}

// --- initTaskOutputListener ---

describe('initTaskOutputListener', () => {
  it('calls window.api.agents.events.onEvent to subscribe', () => {
    useSprintEvents.getState().initTaskOutputListener()
    expect(window.api.agents.events.onEvent).toHaveBeenCalledOnce()
  })

  it('returns a cleanup function that calls the unsubscribe fn', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.agents.events.onEvent).mockReturnValue(unsubscribe)

    const cleanup = useSprintEvents.getState().initTaskOutputListener()
    cleanup()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('returns a cleanup function that is safe when onEvent returns undefined', () => {
    vi.mocked(window.api.agents.events.onEvent).mockReturnValue(undefined as unknown as () => void)

    const cleanup = useSprintEvents.getState().initTaskOutputListener()
    // should not throw
    expect(() => cleanup()).not.toThrow()
  })

  it('appends an event to the correct agent bucket when an event arrives', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const event = makeAgentEvent('first')
    captured!({ agentId: 'agent-1', event })

    const state = useSprintEvents.getState()
    expect(state.taskEvents['agent-1'].count).toBe(1)
    expect(selectLatestEvent('agent-1')(state)).toBe(event)
  })

  it('accumulates multiple events for the same agent', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    captured!({ agentId: 'agent-1', event: makeAgentEvent('e1') })
    captured!({ agentId: 'agent-1', event: makeAgentEvent('e2') })
    captured!({ agentId: 'agent-1', event: makeAgentEvent('e3') })

    expect(useSprintEvents.getState().taskEvents['agent-1'].count).toBe(3)
  })

  it('keeps events isolated between different agents', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    captured!({ agentId: 'agent-x', event: makeAgentEvent('ex') })
    captured!({ agentId: 'agent-y', event: makeAgentEvent('ey') })

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-x'].count).toBe(1)
    expect(taskEvents['agent-y'].count).toBe(1)
  })

  it('selectLatestEvent returns the most recently received event', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const first = makeAgentEvent('first')
    const second = makeAgentEvent('second')
    captured!({ agentId: 'agent-1', event: first })
    captured!({ agentId: 'agent-1', event: second })

    expect(selectLatestEvent('agent-1')(useSprintEvents.getState())).toBe(second)
  })

  it('preserves existing events from other agents when a new event arrives', () => {
    useSprintEvents.setState({
      taskEvents: { 'agent-existing': makeRingBuffer([makeAgentEvent('old')]) }
    })

    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()
    captured!({ agentId: 'agent-new', event: makeAgentEvent('new') })

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-existing'].count).toBe(1)
    expect(taskEvents['agent-new'].count).toBe(1)
  })

  it('caps events at MAX_EVENTS_PER_AGENT (500) — buffer count stays at 500 on overflow', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    // Pre-fill with 500 events via a ring buffer
    const existingEvents = Array.from({ length: 500 }, (_, i) => makeAgentEvent(`e${i}`))
    useSprintEvents.setState({ taskEvents: { 'agent-1': makeRingBuffer(existingEvents) } })

    // Push one more — ring buffer wraps; count stays at 500
    const overflow = makeAgentEvent('overflow')
    captured!({ agentId: 'agent-1', event: overflow })

    const buf = useSprintEvents.getState().taskEvents['agent-1']
    expect(buf.count).toBe(500)
    // The overflow event should be the most recent (last read)
    expect(selectLatestEvent('agent-1')(useSprintEvents.getState())).toBe(overflow)
  })

  it('works with TaskOutputEvent shapes as well as AgentEvent shapes', () => {
    let captured: ((payload: { agentId: string; event: TaskOutputEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb as unknown as typeof captured
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const event = makeTaskOutputEvent('task-123', 'agent:started')
    captured!({ agentId: 'agent-2', event })

    const state = useSprintEvents.getState()
    expect(state.taskEvents['agent-2'].count).toBe(1)
    expect(selectLatestEvent('agent-2')(state)).toBe(event)
  })
})

// --- readAgentEvents ---

describe('readAgentEvents', () => {
  it('returns events in insertion order', () => {
    let captured: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      captured = cb
      return () => {}
    })

    useSprintEvents.getState().initTaskOutputListener()

    const e1 = makeAgentEvent('e1')
    const e2 = makeAgentEvent('e2')
    const e3 = makeAgentEvent('e3')
    captured!({ agentId: 'agent-1', event: e1 })
    captured!({ agentId: 'agent-1', event: e2 })
    captured!({ agentId: 'agent-1', event: e3 })

    const events = readAgentEvents(useSprintEvents.getState(), 'agent-1')
    expect(events).toEqual([e1, e2, e3])
  })

  it('returns an empty array for an unknown agent', () => {
    expect(readAgentEvents(useSprintEvents.getState(), 'unknown')).toEqual([])
  })
})

// --- clearTaskEvents ---

describe('clearTaskEvents', () => {
  it('removes events for the given agent', () => {
    useSprintEvents.setState({
      taskEvents: {
        'agent-a': makeRingBuffer([makeAgentEvent('a1'), makeAgentEvent('a2')]),
        'agent-b': makeRingBuffer([makeAgentEvent('b1')])
      }
    })

    useSprintEvents.getState().clearTaskEvents('agent-a')

    const state = useSprintEvents.getState()
    expect(state.taskEvents['agent-a']).toBeUndefined()
    expect(selectLatestEvent('agent-a')(state)).toBeUndefined()
  })

  it('leaves other agents untouched', () => {
    useSprintEvents.setState({
      taskEvents: {
        'agent-a': makeRingBuffer([makeAgentEvent('a1')]),
        'agent-b': makeRingBuffer([makeAgentEvent('b1')])
      }
    })

    useSprintEvents.getState().clearTaskEvents('agent-a')

    const state = useSprintEvents.getState()
    expect(state.taskEvents['agent-b'].count).toBe(1)
    expect(selectLatestEvent('agent-b')(state)).toBeDefined()
  })

  it('is a no-op when the agent id does not exist', () => {
    useSprintEvents.setState({
      taskEvents: { 'agent-a': makeRingBuffer([makeAgentEvent('a1')]) }
    })

    // should not throw
    useSprintEvents.getState().clearTaskEvents('nonexistent')

    const { taskEvents } = useSprintEvents.getState()
    expect(taskEvents['agent-a'].count).toBe(1)
  })

  it('handles clearing from an empty store without throwing', () => {
    expect(() => useSprintEvents.getState().clearTaskEvents('any-id')).not.toThrow()
    expect(useSprintEvents.getState().taskEvents).toEqual({})
  })
})

// --- initial state ---

describe('initial state', () => {
  it('has empty taskEvents', () => {
    expect(useSprintEvents.getState().taskEvents).toEqual({})
  })

  it('selectLatestEvent returns undefined for unknown agent', () => {
    expect(selectLatestEvent('unknown')(useSprintEvents.getState())).toBeUndefined()
  })
})
