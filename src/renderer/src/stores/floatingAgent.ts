import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface FloatingAgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface FloatingAgentState {
  isOpen: boolean
  sessionId: string | null
  agentId: string | null
  messages: FloatingAgentMessage[]
  streamingMessageId: string | null
  /** Rough token estimate — 1 token ≈ 4 chars */
  estimatedTokens: number
  lastActivityAt: number | null

  open: () => void
  close: () => void
  toggle: () => void
  addMessage: (msg: Omit<FloatingAgentMessage, 'id' | 'timestamp'>) => void
  appendAssistantChunk: (chunk: string) => void
  resetSession: () => void
  setSessionId: (id: string) => void
  setAgentId: (id: string) => void
  trimIfNeeded: () => void
}

const TOKEN_LIMIT = 50_000
const INACTIVITY_MS = 24 * 60 * 60 * 1000

function estimateTokens(messages: FloatingAgentMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
}

export const useFloatingAgentStore = create<FloatingAgentState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      sessionId: null,
      agentId: null,
      messages: [],
      streamingMessageId: null,
      estimatedTokens: 0,
      lastActivityAt: null,

      open: () => {
        const { lastActivityAt, resetSession } = get()
        if (lastActivityAt && Date.now() - lastActivityAt > INACTIVITY_MS) {
          resetSession()
        }
        set({ isOpen: true })
      },
      close: () => set({ isOpen: false }),
      toggle: () => {
        const { isOpen, open, close } = get()
        isOpen ? close() : open()
      },
      addMessage: (msg) => {
        const full: FloatingAgentMessage = {
          ...msg,
          id: crypto.randomUUID(),
          timestamp: Date.now()
        }
        set((state) => {
          const messages = [...state.messages, full]
          return {
            messages,
            estimatedTokens: estimateTokens(messages),
            lastActivityAt: Date.now()
          }
        })
        get().trimIfNeeded()
      },
      appendAssistantChunk: (chunk: string) =>
        set((state) => {
          const msgs = state.messages
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant' && last.id === state.streamingMessageId) {
            const updated = [...msgs.slice(0, -1), { ...last, content: last.content + chunk }]
            return { messages: updated, estimatedTokens: estimateTokens(updated) }
          }
          const id = crypto.randomUUID()
          const updated = [
            ...msgs,
            { id, role: 'assistant' as const, content: chunk, timestamp: Date.now() }
          ]
          return {
            messages: updated,
            estimatedTokens: estimateTokens(updated),
            streamingMessageId: id
          }
        }),
      setSessionId: (id) => set({ sessionId: id }),
      setAgentId: (id) => set({ agentId: id }),
      resetSession: () =>
        set({
          sessionId: null,
          agentId: null,
          messages: [],
          estimatedTokens: 0,
          lastActivityAt: null,
          streamingMessageId: null
        }),
      trimIfNeeded: () => {
        const { messages, estimatedTokens } = get()
        if (estimatedTokens <= TOKEN_LIMIT) return
        let trimmed = [...messages]
        while (estimateTokens(trimmed) > TOKEN_LIMIT && trimmed.length > 2) {
          trimmed = trimmed.slice(1)
        }
        set({ messages: trimmed, estimatedTokens: estimateTokens(trimmed) })
      }
    }),
    {
      name: 'bde:floating-agent',
      partialize: (s) => ({
        sessionId: s.sessionId,
        agentId: s.agentId,
        messages: s.messages,
        estimatedTokens: s.estimatedTokens,
        lastActivityAt: s.lastActivityAt
      })
    }
  )
)
