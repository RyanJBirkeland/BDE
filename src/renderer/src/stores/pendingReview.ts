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
  pendingComments: Map<string, PendingComment[]>
  addComment: (prKey: string, comment: PendingComment) => void
  updateComment: (prKey: string, commentId: string, body: string) => void
  removeComment: (prKey: string, commentId: string) => void
  clearPending: (prKey: string) => void
  getPendingCount: (prKey: string) => number
}

export const usePendingReviewStore = create<PendingReviewStore>((set, get) => ({
  pendingComments: new Map(),

  addComment: (prKey, comment) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = [...(next.get(prKey) ?? []), comment]
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  updateComment: (prKey, commentId, body) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = (next.get(prKey) ?? []).map((c) =>
        c.id === commentId ? { ...c, body } : c
      )
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  removeComment: (prKey, commentId) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = (next.get(prKey) ?? []).filter((c) => c.id !== commentId)
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  clearPending: (prKey) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      next.delete(prKey)
      return { pendingComments: next }
    }),

  getPendingCount: (prKey) => (get().pendingComments.get(prKey) ?? []).length,
}))
