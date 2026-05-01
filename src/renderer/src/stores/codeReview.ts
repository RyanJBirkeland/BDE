import { create } from 'zustand'

export type ReviewTab = 'changes' | 'commits' | 'tests' | 'conversation'
export type DiffMode = 'diff' | 'commits' | 'tests'

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
  diffMode: DiffMode
  diffFiles: DiffFile[]
  commits: ReviewCommit[]
  loading: Record<string, boolean>
  error: string | null
  selectedBatchIds: Set<string>
  reviewSummary: string | null
  summaryLoading: boolean
  selectedDiffFile: string | null
  /** Monotonic counter — increment to force useReviewChanges to re-fetch the diff. */
  diffRefreshKey: number

  selectTask: (taskId: string | null) => void
  setActiveTab: (tab: ReviewTab) => void
  setDiffMode: (mode: DiffMode) => void
  setDiffFiles: (files: DiffFile[]) => void
  setCommits: (commits: ReviewCommit[]) => void
  setLoading: (key: string, loading: boolean) => void
  setError: (error: string | null) => void
  toggleBatchId: (id: string) => void
  selectAllBatch: (ids: string[]) => void
  clearBatch: () => void
  /** Remove any batch-selected IDs that are no longer in the given valid set. */
  pruneBatch: (validIds: string[]) => void
  setReviewSummary: (summary: string | null) => void
  setSummaryLoading: (loading: boolean) => void
  setSelectedDiffFile: (path: string | null) => void
  /** Force a diff re-fetch (e.g. after manually restoring a missing worktree). */
  retryDiff: () => void
  reset: () => void
}

const initialState = {
  selectedTaskId: null as string | null,
  activeTab: 'changes' as ReviewTab,
  diffMode: 'diff' as DiffMode,
  diffFiles: [] as DiffFile[],
  commits: [] as ReviewCommit[],
  loading: {} as Record<string, boolean>,
  error: null as string | null,
  selectedBatchIds: new Set<string>(),
  reviewSummary: null as string | null,
  summaryLoading: false,
  selectedDiffFile: null as string | null,
  diffRefreshKey: 0
}

export const useCodeReviewStore = create<CodeReviewState>((set) => ({
  ...initialState,
  selectTask: (taskId): void =>
    set({
      selectedTaskId: taskId,
      diffMode: 'diff',
      diffFiles: [],
      commits: [],
      error: null,
      reviewSummary: null,
      summaryLoading: false,
      selectedDiffFile: null
    }),
  setActiveTab: (tab): void => set({ activeTab: tab }),
  setDiffMode: (mode): void => set({ diffMode: mode }),
  setDiffFiles: (files): void => set({ diffFiles: files, selectedDiffFile: null }),
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
  pruneBatch: (validIds): void =>
    set((s) => {
      const valid = new Set(validIds)
      const next = new Set([...s.selectedBatchIds].filter((id) => valid.has(id)))
      return next.size === s.selectedBatchIds.size ? {} : { selectedBatchIds: next }
    }),
  setReviewSummary: (summary): void => set({ reviewSummary: summary }),
  setSummaryLoading: (loading): void => set({ summaryLoading: loading }),
  setSelectedDiffFile: (path): void => set({ selectedDiffFile: path }),
  retryDiff: (): void => set((s) => ({ diffRefreshKey: s.diffRefreshKey + 1, error: null })),
  reset: (): void => set(initialState)
}))
