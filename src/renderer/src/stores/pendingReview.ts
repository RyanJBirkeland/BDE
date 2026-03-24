import { create } from 'zustand'

export interface PendingComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  body: string
}

interface PendingReviewStore {
  pendingComments: Record<string, PendingComment[]>
  addComment: (prKey: string, comment: PendingComment) => void
  updateComment: (prKey: string, commentId: string, body: string) => void
  removeComment: (prKey: string, commentId: string) => void
  clearPending: (prKey: string) => void
  getPendingCount: (prKey: string) => number
}

export const usePendingReviewStore = create<PendingReviewStore>((set, get) => ({
  pendingComments: {},

  addComment: (prKey, comment) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: [...(state.pendingComments[prKey] ?? []), comment],
      },
    })),

  updateComment: (prKey, commentId, body) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: (state.pendingComments[prKey] ?? []).map((c) =>
          c.id === commentId ? { ...c, body } : c
        ),
      },
    })),

  removeComment: (prKey, commentId) =>
    set((state) => ({
      pendingComments: {
        ...state.pendingComments,
        [prKey]: (state.pendingComments[prKey] ?? []).filter((c) => c.id !== commentId),
      },
    })),

  clearPending: (prKey) =>
    set((state) => {
      const { [prKey]: _, ...rest } = state.pendingComments
      return { pendingComments: rest }
    }),

  getPendingCount: (prKey) => (get().pendingComments[prKey] ?? []).length,
}))
