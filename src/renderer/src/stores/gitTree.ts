import { create } from 'zustand'
import { toast } from './toasts'
import {
  getRepoPaths,
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commit,
  push,
  getBranches
} from '../services/git'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitFileEntry {
  path: string
  status: string
}

interface GitTreeState {
  // --- Data ---
  branch: string
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
  untracked: GitFileEntry[]
  loading: boolean
  commitLoading: boolean
  pushLoading: boolean
  lastError: string | null
  lastErrorOp: 'push' | 'commit' | null
  selectedFile: GitFileEntry | null
  selectedStaged: boolean
  diffContent: string
  commitMessage: string
  repoPaths: string[]
  activeRepo: string | null
  branches: string[]

  // --- Actions ---
  fetchStatus: (cwd: string) => Promise<void>
  selectFile: (cwd: string, path: string, staged: boolean) => Promise<void>
  clearSelection: () => void
  stageFile: (cwd: string, path: string) => Promise<void>
  unstageFile: (cwd: string, path: string) => Promise<void>
  unstageAll: (cwd: string) => Promise<void>
  setCommitMessage: (msg: string) => void
  commit: (cwd: string) => Promise<void>
  push: (cwd: string) => Promise<void>
  clearError: () => void
  setLastError: (error: string) => void
  fetchBranches: (cwd: string) => Promise<void>
  setActiveRepo: (path: string) => void
  loadRepoPaths: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGitTreeStore = create<GitTreeState>((set, get) => ({
  branch: '',
  staged: [],
  unstaged: [],
  untracked: [],
  loading: false,
  commitLoading: false,
  pushLoading: false,
  lastError: null,
  lastErrorOp: null,
  selectedFile: null,
  selectedStaged: false,
  diffContent: '',
  commitMessage: '',
  repoPaths: [],
  activeRepo: null,
  branches: [],

  fetchStatus: async (cwd: string): Promise<void> => {
    set({ loading: true })
    try {
      const result = await getGitStatus(cwd)
      const files = result?.files ?? []
      const branch = result?.branch ?? ''
      const staged: GitFileEntry[] = []
      const unstaged: GitFileEntry[] = []
      const untracked: GitFileEntry[] = []

      for (const f of files) {
        if (f.status === '?') {
          untracked.push({ path: f.path, status: f.status })
        } else if (f.staged) {
          staged.push({ path: f.path, status: f.status })
        } else {
          unstaged.push({ path: f.path, status: f.status })
        }
      }

      set({ staged, unstaged, untracked, branch, loading: false })
    } catch (err) {
      console.error('Failed to fetch git status:', err)
      set({ loading: false })
      toast.error('Failed to fetch git status')
    }
  },

  selectFile: async (cwd: string, path: string, isStaged: boolean): Promise<void> => {
    const entry = isStaged
      ? get().staged.find((f) => f.path === path)
      : [...get().unstaged, ...get().untracked].find((f) => f.path === path)

    if (!entry) return

    set({ selectedFile: entry, selectedStaged: isStaged, diffContent: '' })

    try {
      const diff = await getGitDiff(cwd, path)
      set({ diffContent: diff ?? '' })
    } catch (err) {
      console.error('Failed to fetch diff:', err)
      set({ diffContent: '' })
    }
  },

  clearSelection: (): void => {
    set({ selectedFile: null, selectedStaged: false, diffContent: '' })
  },

  stageFile: async (cwd: string, path: string): Promise<void> => {
    try {
      await stageFiles(cwd, [path])
      await get().fetchStatus(cwd)
    } catch (err) {
      console.error(`Failed to stage ${path}:`, err)
      toast.error(`Failed to stage ${path}`)
    }
  },

  unstageFile: async (cwd: string, path: string): Promise<void> => {
    try {
      await unstageFiles(cwd, [path])
      await get().fetchStatus(cwd)
    } catch (err) {
      console.error(`Failed to unstage ${path}:`, err)
      toast.error(`Failed to unstage ${path}`)
    }
  },

  unstageAll: async (cwd: string): Promise<void> => {
    const { staged } = get()
    const paths = staged.map((f) => f.path)
    if (paths.length === 0) return
    try {
      await unstageFiles(cwd, paths)
      await get().fetchStatus(cwd)
    } catch (err) {
      console.error('Failed to unstage all files:', err)
      toast.error('Failed to unstage all files')
    }
  },

  setCommitMessage: (msg: string): void => {
    set({ commitMessage: msg })
  },

  commit: async (cwd: string): Promise<void> => {
    const { commitMessage, staged, commitLoading } = get()
    if (!commitMessage.trim() || staged.length === 0 || commitLoading) return
    set({ commitLoading: true, lastError: null, lastErrorOp: null })
    try {
      await commit(cwd, commitMessage)
      set({ commitMessage: '', commitLoading: false })
      await get().fetchStatus(cwd)
      toast.success('Committed successfully')
    } catch (err) {
      const message = `Commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      set({ commitLoading: false, lastError: message, lastErrorOp: 'commit' })
      toast.error(message)
    }
  },

  push: async (cwd: string): Promise<void> => {
    if (get().pushLoading) return
    set({ pushLoading: true, lastError: null, lastErrorOp: null })
    try {
      await push(cwd)
      set({ pushLoading: false })
      toast.success('Pushed successfully')
    } catch (err) {
      const message = `Push failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      set({ pushLoading: false, lastError: message, lastErrorOp: 'push' })
      toast.error(message)
    }
  },

  clearError: (): void => {
    set({ lastError: null, lastErrorOp: null })
  },

  setLastError: (error: string): void => {
    set({ lastError: error })
  },

  fetchBranches: async (cwd: string): Promise<void> => {
    try {
      const result = await getBranches(cwd)
      const branches = result?.branches ?? []
      const currentBranch = result?.current ?? ''
      set({ branches, branch: currentBranch })
    } catch (err) {
      console.error('Failed to fetch branches:', err)
      set({ branches: [] })
    }
  },

  setActiveRepo: (path: string): void => {
    set({ activeRepo: path })
  },

  loadRepoPaths: async (): Promise<void> => {
    try {
      const repoMap = await getRepoPaths()
      const repoPaths = repoMap ? Object.values(repoMap) : []
      set({ repoPaths })
      const firstRepo = repoPaths[0]
      if (firstRepo && !get().activeRepo) {
        set({ activeRepo: firstRepo })
      }
    } catch {
      set({ repoPaths: [] })
    }
  }
}))
