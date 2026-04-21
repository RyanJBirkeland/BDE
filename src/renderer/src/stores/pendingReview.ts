import { create } from 'zustand'
import { createDebouncedPersister } from '../lib/createDebouncedPersister'

export interface PendingComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number | undefined
  startSide?: 'LEFT' | 'RIGHT' | undefined
  body: string
}

const STORAGE_KEY = 'bde:pendingReviewComments'

interface PendingReviewStore {
  pendingComments: Record<string, PendingComment[]>
  addComment: (prKey: string, comment: PendingComment) => void
  updateComment: (prKey: string, commentId: string, body: string) => void
  removeComment: (prKey: string, commentId: string) => void
  clearPending: (prKey: string) => void
  getPendingCount: (prKey: string) => number
  restoreFromStorage: () => void
}

export const usePendingReviewStore = create<PendingReviewStore>((set, get) => ({
  pendingComments: {},

  addComment: (prKey, comment) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: [...(state.pendingComments[prKey] ?? []), comment]
      }
    })),

  updateComment: (prKey, commentId, body) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: (state.pendingComments[prKey] ?? []).map((c) =>
          c.id === commentId ? { ...c, body } : c
        )
      }
    })),

  removeComment: (prKey, commentId) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: (state.pendingComments[prKey] ?? []).filter((c) => c.id !== commentId)
      }
    })),

  clearPending: (prKey) =>
    set((state) => {
      const { [prKey]: _, ...rest } = state.pendingComments
      return { pendingComments: rest }
    }),

  getPendingCount: (prKey) => (get().pendingComments[prKey] ?? []).length,

  restoreFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, PendingComment[]>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Validate structure of individual PendingComment entries
        const validated: Record<string, PendingComment[]> = {}
        for (const [key, comments] of Object.entries(parsed)) {
          if (Array.isArray(comments)) {
            validated[key] = comments.filter(
              (c) =>
                typeof c.id === 'string' &&
                typeof c.path === 'string' &&
                typeof c.body === 'string' &&
                typeof c.line === 'number' &&
                (c.side === 'LEFT' || c.side === 'RIGHT')
            )
          }
        }
        set({ pendingComments: validated })
      }
    } catch {
      // Corrupt localStorage — ignore and start fresh
    }
  }
}))

// Auto-persist to localStorage whenever pendingComments changes (debounced 500ms)
const [persistPendingComments] = createDebouncedPersister<Record<string, PendingComment[]>>(
  (pendingComments) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingComments))
    } catch {
      // Storage quota exceeded or unavailable — ignore
    }
  },
  500
)

usePendingReviewStore.subscribe((state) => {
  persistPendingComments(state.pendingComments)
})

// Flush immediately on window close to prevent data loss
function flushToStorage(): void {
  try {
    const state = usePendingReviewStore.getState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pendingComments))
  } catch {
    // Storage quota exceeded or unavailable — ignore
  }
}

window.addEventListener('beforeunload', flushToStorage)
