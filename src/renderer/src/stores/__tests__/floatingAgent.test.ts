import { describe, it, expect, beforeEach } from 'vitest'
import { useFloatingAgentStore } from '../floatingAgent'

const RESET_STATE = {
  isOpen: false,
  sessionId: null,
  agentId: null,
  messages: [],
  streamingMessageId: null,
  isSending: false,
  estimatedTokens: 0,
  lastActivityAt: null
}

beforeEach(() => {
  useFloatingAgentStore.setState(RESET_STATE)
})

describe('open', () => {
  it('sets isOpen to true', () => {
    useFloatingAgentStore.getState().open()
    expect(useFloatingAgentStore.getState().isOpen).toBe(true)
  })

  it('preserves session if activity was recent', () => {
    useFloatingAgentStore.setState({
      sessionId: 'ses-1',
      lastActivityAt: Date.now() - 1000
    })
    useFloatingAgentStore.getState().open()
    expect(useFloatingAgentStore.getState().sessionId).toBe('ses-1')
  })

  it('resets session if lastActivityAt is more than 24h ago', () => {
    useFloatingAgentStore.setState({
      sessionId: 'ses-old',
      messages: [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 0 }],
      lastActivityAt: Date.now() - 25 * 60 * 60 * 1000
    })
    useFloatingAgentStore.getState().open()
    expect(useFloatingAgentStore.getState().sessionId).toBeNull()
    expect(useFloatingAgentStore.getState().messages).toHaveLength(0)
  })
})

describe('close', () => {
  it('sets isOpen to false', () => {
    useFloatingAgentStore.setState({ isOpen: true })
    useFloatingAgentStore.getState().close()
    expect(useFloatingAgentStore.getState().isOpen).toBe(false)
  })
})

describe('toggle', () => {
  it('opens when closed', () => {
    useFloatingAgentStore.getState().toggle()
    expect(useFloatingAgentStore.getState().isOpen).toBe(true)
  })

  it('closes when open', () => {
    useFloatingAgentStore.setState({ isOpen: true })
    useFloatingAgentStore.getState().toggle()
    expect(useFloatingAgentStore.getState().isOpen).toBe(false)
  })
})

describe('addMessage', () => {
  it('appends message and updates estimatedTokens', () => {
    useFloatingAgentStore.getState().addMessage({ role: 'user', content: 'hello world' })
    const state = useFloatingAgentStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toBe('hello world')
    expect(state.estimatedTokens).toBeGreaterThan(0)
  })

  it('sets lastActivityAt', () => {
    const before = Date.now()
    useFloatingAgentStore.getState().addMessage({ role: 'user', content: 'hi' })
    expect(useFloatingAgentStore.getState().lastActivityAt).toBeGreaterThanOrEqual(before)
  })
})

describe('resetSession', () => {
  it('clears sessionId, agentId, messages, tokens, activityAt, and isSending', () => {
    useFloatingAgentStore.setState({
      sessionId: 'ses-1',
      agentId: 'agent-1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }],
      estimatedTokens: 100,
      lastActivityAt: 12345,
      isSending: true
    })
    useFloatingAgentStore.getState().resetSession()
    const state = useFloatingAgentStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.agentId).toBeNull()
    expect(state.messages).toHaveLength(0)
    expect(state.estimatedTokens).toBe(0)
    expect(state.lastActivityAt).toBeNull()
    expect(state.isSending).toBe(false)
  })
})

describe('trimIfNeeded', () => {
  it('drops oldest messages when over 50k token estimate', () => {
    const longContent = 'x'.repeat(4 * 50_001)
    useFloatingAgentStore.setState({
      messages: [
        { id: 'old', role: 'user', content: longContent, timestamp: 0 },
        { id: 'mid', role: 'assistant', content: 'middle', timestamp: 1 },
        { id: 'keep', role: 'user', content: 'short', timestamp: 2 }
      ],
      estimatedTokens: Math.ceil(longContent.length / 4) + 4
    })
    useFloatingAgentStore.getState().trimIfNeeded()
    const { messages } = useFloatingAgentStore.getState()
    expect(messages.find((m) => m.id === 'old')).toBeUndefined()
    expect(messages.find((m) => m.id === 'keep')).toBeDefined()
  })

  it('does nothing when under token limit', () => {
    useFloatingAgentStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'short', timestamp: 0 }],
      estimatedTokens: 2
    })
    useFloatingAgentStore.getState().trimIfNeeded()
    expect(useFloatingAgentStore.getState().messages).toHaveLength(1)
  })
})

describe('appendAssistantChunk', () => {
  it('creates a new assistant message when no streaming message exists', () => {
    useFloatingAgentStore.getState().appendAssistantChunk('Hello')
    const { messages, streamingMessageId } = useFloatingAgentStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe('Hello')
    expect(streamingMessageId).toBe(messages[0].id)
  })

  it('appends to the current streaming message', () => {
    useFloatingAgentStore.getState().appendAssistantChunk('Hello')
    useFloatingAgentStore.getState().appendAssistantChunk(' world')
    const { messages } = useFloatingAgentStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Hello world')
  })

  it('starts a new message when streamingMessageId does not match last message', () => {
    useFloatingAgentStore.setState({
      messages: [{ id: 'other', role: 'assistant', content: 'old', timestamp: 0 }],
      streamingMessageId: 'different-id'
    })
    useFloatingAgentStore.getState().appendAssistantChunk('new chunk')
    const { messages } = useFloatingAgentStore.getState()
    expect(messages).toHaveLength(2)
  })
})

describe('setSessionId / setAgentId / setIsSending', () => {
  it('sets sessionId', () => {
    useFloatingAgentStore.getState().setSessionId('ses-abc')
    expect(useFloatingAgentStore.getState().sessionId).toBe('ses-abc')
  })

  it('sets agentId', () => {
    useFloatingAgentStore.getState().setAgentId('agent-xyz')
    expect(useFloatingAgentStore.getState().agentId).toBe('agent-xyz')
  })

  it('clears agentId with null', () => {
    useFloatingAgentStore.setState({ agentId: 'agent-old' })
    useFloatingAgentStore.getState().setAgentId(null)
    expect(useFloatingAgentStore.getState().agentId).toBeNull()
  })

  it('sets isSending', () => {
    useFloatingAgentStore.getState().setIsSending(true)
    expect(useFloatingAgentStore.getState().isSending).toBe(true)
    useFloatingAgentStore.getState().setIsSending(false)
    expect(useFloatingAgentStore.getState().isSending).toBe(false)
  })
})
