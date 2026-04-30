import { describe, it, expect, beforeEach, vi } from 'vitest'

// Patch localStorage before importing the store so the store's module-level
// initialMessages() call reads the test's localStorage state.
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

import { useCopilotStore } from '../copilot'
import type { CopilotMessage } from '../copilot'

function makeMsg(overrides: Partial<CopilotMessage> = {}): CopilotMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides
  }
}

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  useCopilotStore.getState().reset()
})

describe('useCopilotStore', () => {
  it('starts with a welcome message', () => {
    const { messages } = useCopilotStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('system')
  })

  it('addMessage appends to the messages list', () => {
    useCopilotStore.getState().addMessage(makeMsg({ content: 'First message' }))
    const { messages } = useCopilotStore.getState()
    expect(messages).toHaveLength(2)
    expect(messages[1]?.content).toBe('First message')
  })

  it('setLoading updates loading state', () => {
    useCopilotStore.getState().setLoading(true)
    expect(useCopilotStore.getState().loading).toBe(true)
    useCopilotStore.getState().setLoading(false)
    expect(useCopilotStore.getState().loading).toBe(false)
  })

  it('startStreaming sets streamingMessageId and activeStreamId', () => {
    const msg = makeMsg({ role: 'assistant', content: '' })
    useCopilotStore.getState().addMessage(msg)
    useCopilotStore.getState().startStreaming(msg.id, 'stream-42')

    const state = useCopilotStore.getState()
    expect(state.streamingMessageId).toBe(msg.id)
    expect(state.activeStreamId).toBe('stream-42')
    expect(state.loading).toBe(true)
  })

  it('appendToStreaming appends a chunk to the streaming message content', () => {
    const msg = makeMsg({ role: 'assistant', content: '' })
    useCopilotStore.getState().addMessage(msg)
    useCopilotStore.getState().startStreaming(msg.id, 'stream-1')
    useCopilotStore.getState().appendToStreaming('Hello ')
    useCopilotStore.getState().appendToStreaming('world')

    const streamMsg = useCopilotStore.getState().messages.find((m) => m.id === msg.id)
    expect(streamMsg?.content).toBe('Hello world')
  })

  it('finishStreaming clears streaming state and sets insertable', () => {
    const msg = makeMsg({ role: 'assistant', content: 'Done content' })
    useCopilotStore.getState().addMessage(msg)
    useCopilotStore.getState().startStreaming(msg.id, 'stream-1')
    useCopilotStore.getState().finishStreaming(true)

    const state = useCopilotStore.getState()
    expect(state.streamingMessageId).toBeNull()
    expect(state.activeStreamId).toBeNull()
    expect(state.loading).toBe(false)

    const streamMsg = state.messages.find((m) => m.id === msg.id)
    expect(streamMsg?.insertable).toBe(true)
  })

  it('reset clears messages back to welcome only', () => {
    useCopilotStore.getState().addMessage(makeMsg())
    useCopilotStore.getState().addMessage(makeMsg())
    useCopilotStore.getState().reset()

    expect(useCopilotStore.getState().messages).toHaveLength(1)
    expect(useCopilotStore.getState().messages[0]?.role).toBe('system')
  })

  it('caps messages at 200 in-memory', () => {
    // Add 201 messages (including the existing welcome message, addMessage adds 200 more)
    const { addMessage } = useCopilotStore.getState()
    for (let i = 0; i < 201; i++) {
      addMessage(makeMsg({ content: `msg ${i}` }))
    }

    // Should be capped at 200 (oldest evicted)
    expect(useCopilotStore.getState().messages.length).toBeLessThanOrEqual(200)
  })
})
