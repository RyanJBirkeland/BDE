import { create } from 'zustand'
import type { ReviewResult, PartnerMessage } from '../../../shared/types'

const MESSAGES_STORAGE_KEY = 'bde:review-partner-messages'
const PANEL_OPEN_KEY = 'bde:review-partner-open'
const MAX_MESSAGES_PER_TASK = 100
const MAX_TASKS_IN_LOCAL_STORAGE = 20

export interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: ReviewResult | undefined
  error?: string | undefined
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

  clearMessages: (taskId: string) => void
}

function loadMessages(): PersistedMessages {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY)
    if (!raw) return { messagesByTask: {}, lruOrder: [] }
    const parsed = JSON.parse(raw)
    return {
      messagesByTask: parsed.messagesByTask ?? {},
      lruOrder: parsed.lruOrder ?? []
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

  clearMessages(taskId) {
    set((s) => {
      const nextMsgs = { ...s.messagesByTask, [taskId]: [] }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })
  }
}))
