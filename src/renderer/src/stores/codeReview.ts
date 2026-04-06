import { create } from 'zustand'

export type ReviewTab = 'changes' | 'commits' | 'tests' | 'conversation'

export interface DiffFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string
}

export interface ReviewCommit {
  hash: string
  message: string
  author: string
  date: string
}

interface CodeReviewState {
  selectedTaskId: string | null
  activeTab: ReviewTab
  diffFiles: DiffFile[]
  commits: ReviewCommit[]
  loading: Record<string, boolean>
  error: string | null
  selectedBatchIds: Set<string>
  reviewSummary: string | null
  summaryLoading: boolean

  selectTask: (taskId: string | null) => void
  setActiveTab: (tab: ReviewTab) => void
  setDiffFiles: (files: DiffFile[]) => void
  setCommits: (commits: ReviewCommit[]) => void
  setLoading: (key: string, loading: boolean) => void
  setError: (error: string | null) => void
  toggleBatchId: (id: string) => void
  selectAllBatch: (ids: string[]) => void
  clearBatch: () => void
  setReviewSummary: (summary: string | null) => void
  setSummaryLoading: (loading: boolean) => void
  reset: () => void
}

const initialState = {
  selectedTaskId: null as string | null,
  activeTab: 'changes' as ReviewTab,
  diffFiles: [] as DiffFile[],
  commits: [] as ReviewCommit[],
  loading: {} as Record<string, boolean>,
  error: null as string | null,
  selectedBatchIds: new Set<string>(),
  reviewSummary: null as string | null,
  summaryLoading: false
}

export const useCodeReviewStore = create<CodeReviewState>((set) => ({
  ...initialState,
  selectTask: (taskId): void =>
    set({
      selectedTaskId: taskId,
      diffFiles: [],
      commits: [],
      error: null,
      reviewSummary: null,
      summaryLoading: false
    }),
  setActiveTab: (tab): void => set({ activeTab: tab }),
  setDiffFiles: (files): void => set({ diffFiles: files }),
  setCommits: (commits): void => set({ commits }),
  setLoading: (key, loading): void => set((s) => ({ loading: { ...s.loading, [key]: loading } })),
  setError: (error): void => set({ error }),
  toggleBatchId: (id): void =>
    set((s) => {
      const next = new Set(s.selectedBatchIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedBatchIds: next }
    }),
  selectAllBatch: (ids): void => set({ selectedBatchIds: new Set(ids) }),
  clearBatch: (): void => set({ selectedBatchIds: new Set() }),
  setReviewSummary: (summary): void => set({ reviewSummary: summary }),
  setSummaryLoading: (loading): void => set({ summaryLoading: loading }),
  reset: (): void => set(initialState)
}))
