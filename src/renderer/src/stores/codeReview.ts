import { create } from 'zustand'

export type ReviewTab = 'changes' | 'commits' | 'conversation'

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

  selectTask: (taskId: string | null) => void
  setActiveTab: (tab: ReviewTab) => void
  setDiffFiles: (files: DiffFile[]) => void
  setCommits: (commits: ReviewCommit[]) => void
  setLoading: (key: string, loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

const initialState = {
  selectedTaskId: null as string | null,
  activeTab: 'changes' as ReviewTab,
  diffFiles: [] as DiffFile[],
  commits: [] as ReviewCommit[],
  loading: {} as Record<string, boolean>,
  error: null as string | null
}

export const useCodeReviewStore = create<CodeReviewState>((set) => ({
  ...initialState,
  selectTask: (taskId): void =>
    set({ selectedTaskId: taskId, diffFiles: [], commits: [], error: null }),
  setActiveTab: (tab): void => set({ activeTab: tab }),
  setDiffFiles: (files): void => set({ diffFiles: files }),
  setCommits: (commits): void => set({ commits }),
  setLoading: (key, loading): void => set((s) => ({ loading: { ...s.loading, [key]: loading } })),
  setError: (error): void => set({ error }),
  reset: (): void => set(initialState)
}))
