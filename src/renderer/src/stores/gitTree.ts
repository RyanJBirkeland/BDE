import { create } from 'zustand'
import { toast } from './toasts'

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
  stageAll: (cwd: string) => Promise<void>
  unstageAll: (cwd: string) => Promise<void>
  setCommitMessage: (msg: string) => void
  commit: (cwd: string) => Promise<void>
  push: (cwd: string) => Promise<void>
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
      const result = await window.api.gitStatus(cwd)
      const files = result?.files ?? []
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

      set({ staged, unstaged, untracked, loading: false })
    } catch {
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
      const diff = await window.api.gitDiff(cwd, path)
      set({ diffContent: diff ?? '' })
    } catch {
      set({ diffContent: '' })
    }
  },

  clearSelection: (): void => {
    set({ selectedFile: null, selectedStaged: false, diffContent: '' })
  },

  stageFile: async (cwd: string, path: string): Promise<void> => {
    try {
      await window.api.gitStage(cwd, [path])
      await get().fetchStatus(cwd)
    } catch {
      toast.error(`Failed to stage ${path}`)
    }
  },

  unstageFile: async (cwd: string, path: string): Promise<void> => {
    try {
      await window.api.gitUnstage(cwd, [path])
      await get().fetchStatus(cwd)
    } catch {
      toast.error(`Failed to unstage ${path}`)
    }
  },

  stageAll: async (cwd: string): Promise<void> => {
    const { unstaged, untracked } = get()
    const paths = [...unstaged, ...untracked].map((f) => f.path)
    if (paths.length === 0) return
    try {
      await window.api.gitStage(cwd, paths)
      await get().fetchStatus(cwd)
    } catch {
      toast.error('Failed to stage all files')
    }
  },

  unstageAll: async (cwd: string): Promise<void> => {
    const { staged } = get()
    const paths = staged.map((f) => f.path)
    if (paths.length === 0) return
    try {
      await window.api.gitUnstage(cwd, paths)
      await get().fetchStatus(cwd)
    } catch {
      toast.error('Failed to unstage all files')
    }
  },

  setCommitMessage: (msg: string): void => {
    set({ commitMessage: msg })
  },

  commit: async (cwd: string): Promise<void> => {
    const { commitMessage, staged } = get()
    if (!commitMessage.trim() || staged.length === 0) return
    try {
      await window.api.gitCommit(cwd, commitMessage)
      set({ commitMessage: '' })
      await get().fetchStatus(cwd)
      toast.success('Committed successfully')
    } catch {
      toast.error('Commit failed')
    }
  },

  push: async (cwd: string): Promise<void> => {
    try {
      await window.api.gitPush(cwd)
      toast.success('Pushed successfully')
    } catch {
      toast.error('Push failed')
    }
  },

  fetchBranches: async (cwd: string): Promise<void> => {
    try {
      const result = await window.api.gitBranches(cwd)
      const branches = result?.branches ?? []
      const currentBranch = result?.current ?? ''
      set({ branches, branch: currentBranch })
    } catch {
      set({ branches: [] })
    }
  },

  setActiveRepo: (path: string): void => {
    set({ activeRepo: path })
  },

  loadRepoPaths: async (): Promise<void> => {
    try {
      const repoMap = await window.api.getRepoPaths()
      const repoPaths = repoMap ? Object.values(repoMap) : []
      set({ repoPaths })
      if (repoPaths.length > 0 && !get().activeRepo) {
        set({ activeRepo: repoPaths[0] })
      }
    } catch {
      set({ repoPaths: [] })
    }
  }
}))
