import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentEventsStore } from '../agentEvents'
import type { AgentEvent } from '../../../../shared/types'

const initialState = {
  events: {}
}

beforeEach(() => {
  useAgentEventsStore.setState(initialState)
  vi.clearAllMocks()
})

function makeEvent(text = 'hello'): AgentEvent {
  return {
    type: 'agent:text',
    text,
    timestamp: Date.now()
  }
}

describe('init', () => {
  it('subscribes to agentEvents.onEvent and returns an unsubscribe function', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.agentEvents.onEvent).mockReturnValue(unsubscribe)

    const cleanup = useAgentEventsStore.getState().init()

    expect(window.api.agentEvents.onEvent).toHaveBeenCalledOnce()
    expect(cleanup).toBe(unsubscribe)
  })

  it('appends events to the correct agent bucket when an event arrives', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentEventsStore.getState().init()

    const event = makeEvent('first')
    capturedCallback!({ agentId: 'agent-a', event })

    const { events } = useAgentEventsStore.getState()
    expect(events['agent-a']).toHaveLength(1)
    expect((events['agent-a'][0] as { type: string; text: string }).text).toBe('first')
  })

  it('accumulates multiple events for the same agent', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentEventsStore.getState().init()

    capturedCallback!({ agentId: 'agent-b', event: makeEvent('e1') })
    capturedCallback!({ agentId: 'agent-b', event: makeEvent('e2') })

    expect(useAgentEventsStore.getState().events['agent-b']).toHaveLength(2)
  })

  it('keeps events for different agents isolated', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentEventsStore.getState().init()

    capturedCallback!({ agentId: 'agent-x', event: makeEvent('ex') })
    capturedCallback!({ agentId: 'agent-y', event: makeEvent('ey') })

    expect(useAgentEventsStore.getState().events['agent-x']).toHaveLength(1)
    expect(useAgentEventsStore.getState().events['agent-y']).toHaveLength(1)
  })
})

describe('loadHistory', () => {
  it('fetches history from IPC and stores it under the agent id', async () => {
    const history = [makeEvent('h1'), makeEvent('h2')]
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue(history)

    await useAgentEventsStore.getState().loadHistory('agent-z')

    expect(window.api.agentEvents.getHistory).toHaveBeenCalledWith('agent-z')
    expect(useAgentEventsStore.getState().events['agent-z']).toHaveLength(2)
    expect(
      (useAgentEventsStore.getState().events['agent-z'][0] as { type: string; text: string }).text
    ).toBe('h1')
  })

  it('overwrites any previously cached events for that agent', async () => {
    useAgentEventsStore.setState({
      events: { 'agent-z': [makeEvent('old-1'), makeEvent('old-2')] }
    })
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue([makeEvent('new-1')])

    await useAgentEventsStore.getState().loadHistory('agent-z')

    const stored = useAgentEventsStore.getState().events['agent-z']
    expect(stored).toHaveLength(1)
    expect((stored[0] as { type: string; text: string }).text).toBe('new-1')
  })

  it('does not affect events for other agents', async () => {
    useAgentEventsStore.setState({
      events: { other: [makeEvent('o1')] }
    })
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue([makeEvent('n1')])

    await useAgentEventsStore.getState().loadHistory('target')

    expect(useAgentEventsStore.getState().events['other']).toHaveLength(1)
  })
})

describe('clear', () => {
  it('removes the event bucket for the given agent', () => {
    useAgentEventsStore.setState({
      events: {
        'agent-a': [makeEvent('a1')],
        'agent-b': [makeEvent('b1')]
      }
    })

    useAgentEventsStore.getState().clear('agent-a')

    const { events } = useAgentEventsStore.getState()
    expect(events['agent-a']).toBeUndefined()
  })

  it('leaves other agent events untouched', () => {
    useAgentEventsStore.setState({
      events: {
        'agent-a': [makeEvent('a1')],
        'agent-b': [makeEvent('b1')]
      }
    })

    useAgentEventsStore.getState().clear('agent-a')

    expect(useAgentEventsStore.getState().events['agent-b']).toHaveLength(1)
  })

  it('is a no-op for an agent id that has no events', () => {
    useAgentEventsStore.setState({ events: {} })
    // Should not throw
    useAgentEventsStore.getState().clear('nonexistent')
    expect(useAgentEventsStore.getState().events).toEqual({})
  })
})
