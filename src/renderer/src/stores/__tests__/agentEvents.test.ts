import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentEventsStore } from '../agentEvents'
import type { AgentEvent } from '../../../../shared/types'

const initialState = {
  events: {}
}

beforeEach(() => {
  useAgentEventsStore.getState().destroy() // reset module-level guard
  useAgentEventsStore.setState(initialState)
  vi.clearAllMocks()
})

function makeEvent(text = 'hello', timestamp = Date.now()): AgentEvent {
  return {
    type: 'agent:text',
    text,
    timestamp
  }
}

describe('init', () => {
  it('subscribes to agentEvents.onEvent and returns an unsubscribe function', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.agents.events.onEvent).mockReturnValue(unsubscribe)

    const cleanup = useAgentEventsStore.getState().init()

    expect(window.api.agents.events.onEvent).toHaveBeenCalledOnce()
    expect(cleanup).toBe(unsubscribe)
  })

  it('appends events to the correct agent bucket when an event arrives', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
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
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
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
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
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
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue(history)

    await useAgentEventsStore.getState().loadHistory('agent-z')

    expect(window.api.agents.events.getHistory).toHaveBeenCalledWith('agent-z')
    expect(useAgentEventsStore.getState().events['agent-z']).toHaveLength(2)
    expect(
      (useAgentEventsStore.getState().events['agent-z'][0] as { type: string; text: string }).text
    ).toBe('h1')
  })

  it('preserves live events that arrived before history returned', async () => {
    // Scenario: the renderer's live-broadcast subscriber appended `live-a` at
    // t=100 before loadHistory resolved. History returned up to t=50. Both
    // must end up in the store.
    useAgentEventsStore.setState({
      events: { 'agent-z': [makeEvent('live-a', 100)] }
    })
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue([makeEvent('hist-1', 50)])

    await useAgentEventsStore.getState().loadHistory('agent-z')

    const stored = useAgentEventsStore.getState().events['agent-z']
    const texts = stored.map((e) => (e as { text: string }).text)
    expect(texts).toEqual(['hist-1', 'live-a'])
  })

  it('deduplicates events that appear in both history and live stream', async () => {
    const shared = makeEvent('shared', 100)
    useAgentEventsStore.setState({
      events: { 'agent-z': [shared, makeEvent('live-only', 150)] }
    })
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue([
      makeEvent('hist-only', 50),
      shared
    ])

    await useAgentEventsStore.getState().loadHistory('agent-z')

    const stored = useAgentEventsStore.getState().events['agent-z']
    const texts = stored.map((e) => (e as { text: string }).text)
    expect(texts).toEqual(['hist-only', 'shared', 'live-only'])
  })

  it('does not affect events for other agents', async () => {
    useAgentEventsStore.setState({
      events: { other: [makeEvent('o1')] }
    })
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue([makeEvent('n1')])

    await useAgentEventsStore.getState().loadHistory('target')

    expect(useAgentEventsStore.getState().events['other']).toHaveLength(1)
  })

  it('deduplicates tool_result events with large outputs without comparing the output payload', async () => {
    const largeOutput = 'x'.repeat(10_000)
    const sharedToolResult: AgentEvent = {
      type: 'agent:tool_result',
      tool: 'Bash',
      success: true,
      summary: 'ran command',
      output: largeOutput,
      timestamp: 200
    }
    useAgentEventsStore.setState({
      events: { 'agent-w': [sharedToolResult, makeEvent('after', 300)] }
    })
    // History returns an "equivalent" tool_result with the same distinguishing
    // fields but a different (also large) output payload — the dedup key must
    // collapse them rather than keep both, regardless of output content.
    const historyToolResult: AgentEvent = {
      ...sharedToolResult,
      output: 'y'.repeat(10_000)
    }
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue([
      makeEvent('before', 100),
      historyToolResult
    ])

    await useAgentEventsStore.getState().loadHistory('agent-w')

    const stored = useAgentEventsStore.getState().events['agent-w']
    expect(stored).toHaveLength(3)
    expect(stored.map((e) => e.type)).toEqual(['agent:text', 'agent:tool_result', 'agent:text'])
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

describe('event cap (MAX_EVENTS_PER_AGENT = 2000)', () => {
  it('allows up to 2000 events without eviction', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentEventsStore.getState().init()

    for (let i = 0; i < 2000; i++) {
      capturedCallback!({ agentId: 'agent-cap', event: makeEvent(`e${i}`) })
    }

    expect(useAgentEventsStore.getState().events['agent-cap']).toHaveLength(2000)
  })

  it('evicts oldest events once cap is exceeded', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agents.events.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentEventsStore.getState().init()

    for (let i = 0; i < 2001; i++) {
      capturedCallback!({ agentId: 'agent-cap', event: makeEvent(`e${i}`) })
    }

    const events = useAgentEventsStore.getState().events['agent-cap']
    expect(events).toHaveLength(2000)
    // oldest (e0) evicted; e1 is now first, e2000 is last
    expect((events[0] as { text: string }).text).toBe('e1')
    expect((events[events.length - 1] as { text: string }).text).toBe('e2000')
  })

  it('caps loadHistory at 2000 events, keeping the most recent', async () => {
    const bigHistory = Array.from({ length: 2500 }, (_, i) => makeEvent(`h${i}`))
    vi.mocked(window.api.agents.events.getHistory).mockResolvedValue(bigHistory)

    await useAgentEventsStore.getState().loadHistory('agent-hist')

    const events = useAgentEventsStore.getState().events['agent-hist']
    expect(events).toHaveLength(2000)
    // slice(-2000) of 2500 keeps indices 500..2499
    expect((events[0] as { text: string }).text).toBe('h500')
    expect((events[events.length - 1] as { text: string }).text).toBe('h2499')
  })
})
