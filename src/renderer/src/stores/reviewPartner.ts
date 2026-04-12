import { create } from 'zustand'
import type {
  ReviewResult,
  PartnerMessage,
  ChatChunk,
} from '../../../shared/types'

const MESSAGES_STORAGE_KEY = 'bde:review-partner-messages'
const PANEL_OPEN_KEY = 'bde:review-partner-open'
const MAX_MESSAGES_PER_TASK = 100
const MAX_TASKS_IN_LOCAL_STORAGE = 20

export interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: ReviewResult
  error?: string
}

interface PersistedMessages {
  messagesByTask: Record<string, PartnerMessage[]>
  lruOrder: string[] // taskIds, most recently touched last
}

export interface ReviewPartnerStore {
  panelOpen: boolean
  togglePanel: () => void

  reviewByTask: Record<string, ReviewState>
  messagesByTask: Record<string, PartnerMessage[]>
  activeStreamByTask: Record<string, string | null>

  autoReview: (taskId: string, opts?: { force?: boolean }) => Promise<void>
  sendMessage: (taskId: string, content: string) => Promise<void>
  abortStream: (taskId: string) => Promise<void>
  clearMessages: (taskId: string) => void
  appendQuickAction: (taskId: string, prompt: string) => Promise<void>
}

function loadMessages(): PersistedMessages {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY)
    if (!raw) return { messagesByTask: {}, lruOrder: [] }
    const parsed = JSON.parse(raw)
    return {
      messagesByTask: parsed.messagesByTask ?? {},
      lruOrder: parsed.lruOrder ?? [],
    }
  } catch {
    return { messagesByTask: {}, lruOrder: [] }
  }
}

function saveMessages(messagesByTask: Record<string, PartnerMessage[]>): void {
  try {
    const lruOrder = Object.keys(messagesByTask)
    const trimmed: Record<string, PartnerMessage[]> = {}
    const keepIds = lruOrder.slice(-MAX_TASKS_IN_LOCAL_STORAGE)
    for (const id of keepIds) {
      const msgs = messagesByTask[id] ?? []
      trimmed[id] = msgs.slice(-MAX_MESSAGES_PER_TASK)
    }
    localStorage.setItem(
      MESSAGES_STORAGE_KEY,
      JSON.stringify({ messagesByTask: trimmed, lruOrder: keepIds })
    )
  } catch {
    // localStorage full or unavailable — swallow
  }
}

function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function savePanelOpen(value: boolean): void {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, value ? '1' : '0')
  } catch {
    // noop
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const chunkUnsubscribeByTask = new Map<string, () => void>()

const initial = loadMessages()

export const useReviewPartnerStore = create<ReviewPartnerStore>((set, get) => ({
  panelOpen: loadPanelOpen(),
  reviewByTask: {},
  messagesByTask: initial.messagesByTask,
  activeStreamByTask: {},

  togglePanel: () => {
    const next = !get().panelOpen
    set({ panelOpen: next })
    savePanelOpen(next)
  },

  async autoReview(taskId, opts) {
    const prev = get().reviewByTask[taskId]
    if (prev?.status === 'loading') return

    set((s) => ({
      reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'loading' } },
    }))

    try {
      const result = await window.api.review.autoReview(taskId, opts?.force ?? false)
      set((s) => {
        const existingMessages = s.messagesByTask[taskId] ?? []
        // Only seed if the user hasn't started a conversation yet
        const messages =
          existingMessages.length === 0
            ? [
                {
                  id: newId('seed'),
                  role: 'assistant' as const,
                  content: result.openingMessage,
                  timestamp: Date.now(),
                },
              ]
            : existingMessages
        const nextMsgs = { ...s.messagesByTask, [taskId]: messages }
        saveMessages(nextMsgs)
        return {
          reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'ready', result } },
          messagesByTask: nextMsgs,
        }
      })
    } catch (err) {
      set((s) => ({
        reviewByTask: {
          ...s.reviewByTask,
          [taskId]: { status: 'error', error: (err as Error).message },
        },
      }))
    }
  },

  async sendMessage(taskId, content) {
    const userMsg: PartnerMessage = {
      id: newId('u'),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    const streamingMsg: PartnerMessage = {
      id: newId('a'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    }

    set((s) => {
      const prior = s.messagesByTask[taskId] ?? []
      const next = [...prior, userMsg, streamingMsg]
      const nextMsgs = { ...s.messagesByTask, [taskId]: next }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })

    let unsubscribe: (() => void) | null = null
    try {
      // Subscribe BEFORE invoking chatStream so we don't miss early chunks.
      let streamId: string | null = null

      unsubscribe = window.api.review.onChatChunk((_e: unknown, chunk: ChatChunk) => {
        if (!streamId || chunk.streamId !== streamId) return
        set((s) => {
          const msgs = [...(s.messagesByTask[taskId] ?? [])]
          const last = msgs[msgs.length - 1]
          if (!last || last.id !== streamingMsg.id) return s

          if (chunk.error) {
            msgs[msgs.length - 1] = {
              ...last,
              content: (last.content ? last.content + '\n\n' : '') + `Error: ${chunk.error}`,
              streaming: false,
            }
          } else if (chunk.done) {
            msgs[msgs.length - 1] = {
              ...last,
              content: chunk.fullText ?? last.content,
              streaming: false,
            }
          } else if (chunk.chunk) {
            msgs[msgs.length - 1] = { ...last, content: last.content + chunk.chunk }
          }

          const nextMsgs = { ...s.messagesByTask, [taskId]: msgs }
          saveMessages(nextMsgs)

          let activeStreamByTask = s.activeStreamByTask
          if (chunk.done || chunk.error) {
            activeStreamByTask = { ...s.activeStreamByTask, [taskId]: null }
            unsubscribe?.()
            chunkUnsubscribeByTask.delete(taskId)
          }
          return { messagesByTask: nextMsgs, activeStreamByTask }
        })
      })
      chunkUnsubscribeByTask.set(taskId, () => unsubscribe?.())

      const messages = (get().messagesByTask[taskId] ?? []).slice(0, -1) // exclude the empty streaming msg
      const { streamId: sid } = await window.api.review.chatStream({ taskId, messages })
      streamId = sid
      set((s) => ({
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: streamId },
      }))
    } catch (err) {
      set((s) => {
        const msgs = [...(s.messagesByTask[taskId] ?? [])]
        const last = msgs[msgs.length - 1]
        if (last && last.id === streamingMsg.id) {
          msgs[msgs.length - 1] = {
            ...last,
            content: `Error: ${(err as Error).message}`,
            streaming: false,
          }
        }
        return { messagesByTask: { ...s.messagesByTask, [taskId]: msgs } }
      })
      unsubscribe?.()
    }
  },

  async abortStream(taskId) {
    const streamId = get().activeStreamByTask[taskId]
    if (!streamId) return
    set((s) => {
      const msgs = [...(s.messagesByTask[taskId] ?? [])]
      const last = msgs[msgs.length - 1]
      if (last?.streaming) {
        msgs[msgs.length - 1] = { ...last, streaming: false }
      }
      return {
        messagesByTask: { ...s.messagesByTask, [taskId]: msgs },
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: null },
      }
    })
    const unsub = chunkUnsubscribeByTask.get(taskId)
    if (unsub) {
      unsub()
      chunkUnsubscribeByTask.delete(taskId)
    }
    await window.api.review.abortChat(streamId)
  },

  clearMessages(taskId) {
    set((s) => {
      const nextMsgs = { ...s.messagesByTask, [taskId]: [] }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })
  },

  async appendQuickAction(taskId, prompt) {
    await get().sendMessage(taskId, prompt)
  },
}))
