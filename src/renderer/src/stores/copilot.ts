import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  insertable?: boolean
  /**
   * Optional kind discriminator for system messages. `tool-use` indicates the
   * copilot invoked a read-only tool (Read/Grep/Glob) — rendered compactly so
   * users can see what the copilot is grounding its answer in.
   */
  kind?: 'tool-use'
}

interface CopilotState {
  // --- State ---
  visible: boolean
  messages: CopilotMessage[]
  loading: boolean
  streamingMessageId: string | null
  activeStreamId: string | null

  // --- Actions ---
  toggleVisible: () => void
  addMessage: (msg: CopilotMessage) => void
  setLoading: (loading: boolean) => void
  startStreaming: (messageId: string, streamId: string) => void
  appendToStreaming: (chunk: string) => void
  finishStreaming: (insertable: boolean) => void
  reset: () => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'I can help you craft this task. Try asking me to research the codebase, brainstorm approaches, or review your spec.',
  timestamp: Date.now()
}

const COPILOT_STORAGE_KEY = 'bde:copilot-messages'

function loadPersistedMessages(): CopilotMessage[] {
  try {
    const raw = localStorage.getItem(COPILOT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // Ignore corrupt localStorage
  }
  return []
}

function persistMessages(messages: CopilotMessage[]): void {
  try {
    // Only persist the last 100 messages to keep localStorage lean
    const toStore = messages.slice(-100)
    localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // Ignore quota errors
  }
}

function initialMessages(): CopilotMessage[] {
  const persisted = loadPersistedMessages()
  return persisted.length > 0 ? persisted : [{ ...WELCOME_MESSAGE, timestamp: Date.now() }]
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCopilotStore = create<CopilotState>((set) => ({
  visible: true,
  messages: initialMessages(),
  loading: false,
  streamingMessageId: null,
  activeStreamId: null,

  toggleVisible: () => set((s) => ({ visible: !s.visible })),

  addMessage: (msg) =>
    set((s) => {
      const messages = [...s.messages, msg]
      // Cap at 200 messages in memory, but only persist 100
      return { messages: messages.length > 200 ? messages.slice(-200) : messages }
    }),

  setLoading: (loading) => set({ loading }),

  startStreaming: (messageId, streamId) =>
    set({
      streamingMessageId: messageId,
      activeStreamId: streamId,
      loading: true
    }),

  appendToStreaming: (chunk) =>
    set((s) => {
      if (!s.streamingMessageId) return s
      const messages = s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: m.content + chunk } : m
      )
      return { messages }
    }),

  finishStreaming: (insertable) =>
    set((s) => {
      if (!s.streamingMessageId) return s
      const messages = s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, insertable } : m
      )
      return {
        messages,
        streamingMessageId: null,
        activeStreamId: null,
        loading: false
      }
    }),

  reset: () =>
    set({
      messages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
      streamingMessageId: null,
      activeStreamId: null,
      loading: false
    })
}))

// Persist messages to localStorage on change
useCopilotStore.subscribe((state, prev) => {
  if (state.messages !== prev.messages && !state.streamingMessageId) {
    persistMessages(state.messages)
  }
})
