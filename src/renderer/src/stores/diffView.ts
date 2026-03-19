/**
 * DiffView store — git workflow state and actions.
 * Owns: repo selection, branch management, file status, staging, commit, push, diff loading.
 * View renders store state only.
 */
import { create } from 'zustand'
import * as git from '../services/git'
import { parseDiffChunked } from '../lib/diff-parser'
import type { DiffFile } from '../lib/diff-parser'
import { toast } from './toasts'
import { DIFF_SIZE_WARN_BYTES } from '../lib/constants'

interface GitFileEntry {
  path: string
  status: string
  staged: boolean
}

interface DeduplicatedFile extends GitFileEntry {
  hasStaged: boolean
}

/** Deduplicate files — show each path once, preferring unstaged if both exist */
function dedupeFiles(files: GitFileEntry[]): DeduplicatedFile[] {
  const map = new Map<string, DeduplicatedFile>()
  for (const f of files) {
    const existing = map.get(f.path)
    if (existing) {
      if (f.staged) existing.hasStaged = true
      else {
        existing.staged = false
        existing.hasStaged = true
      }
    } else {
      map.set(f.path, { ...f, hasStaged: f.staged })
    }
  }
  return Array.from(map.values())
}

interface DiffViewState {
  // State
  repos: Record<string, string>
  selectedRepo: string | null
  branches: string[]
  currentBranch: string
  files: DeduplicatedFile[]
  selectedFile: string | null
  diffFiles: DiffFile[]
  stagedSet: Set<string>
  commitMsg: string
  loading: boolean
  pushing: boolean
  committing: boolean
  pushOutput: string | null
  error: string | null
  diffSizeWarning: number | null
  rawDiff: string | null

  // Actions
  loadRepos: () => Promise<void>
  selectRepo: (name: string) => void
  setSelectedFile: (path: string | null) => void
  setCommitMsg: (msg: string) => void
  setPushOutput: (output: string | null) => void
  refresh: () => Promise<void>
  loadDiff: () => Promise<void>
  toggleStage: (filePath: string) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  commit: () => Promise<void>
  push: () => Promise<void>
  switchBranch: (branch: string) => Promise<void>
  forceLoadLargeDiff: () => void
}

// Diff parsing abort controller — lives outside store to avoid serialization
let _diffAbortController: AbortController | null = null

export const useDiffViewStore = create<DiffViewState>((set, get) => ({
  repos: {},
  selectedRepo: null,
  branches: [],
  currentBranch: '',
  files: [],
  selectedFile: null,
  diffFiles: [],
  stagedSet: new Set(),
  commitMsg: '',
  loading: true,
  pushing: false,
  committing: false,
  pushOutput: null,
  error: null,
  diffSizeWarning: null,
  rawDiff: null,

  loadRepos: async () => {
    try {
      const paths = await git.getRepoPaths()
      set({ repos: paths })
      if (paths['bde']) set({ selectedRepo: 'bde' })
      else {
        const first = Object.keys(paths)[0]
        if (first) set({ selectedRepo: first })
      }
    } catch {
      set({ error: 'Failed to load repo paths' })
    }
  },

  selectRepo: (name) => {
    set({ selectedRepo: name, selectedFile: null, pushOutput: null })
  },

  setSelectedFile: (path) => {
    set({ selectedFile: path })
  },

  setCommitMsg: (msg) => set({ commitMsg: msg }),
  setPushOutput: (output) => set({ pushOutput: output }),

  refresh: async () => {
    const { selectedRepo, repos } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    set({ loading: true, error: null })
    try {
      const [statusResult, branchResult] = await Promise.all([
        git.getStatus(repoPath),
        git.getBranches(repoPath),
      ])
      const deduped = dedupeFiles(statusResult.files)
      const staged = new Set<string>()
      for (const f of statusResult.files) {
        if (f.staged) staged.add(f.path)
      }
      set({
        files: deduped,
        branches: branchResult.branches,
        currentBranch: branchResult.current,
        stagedSet: staged,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load status' })
    } finally {
      set({ loading: false })
    }
  },

  loadDiff: async () => {
    const { selectedRepo, repos, selectedFile } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    set({ diffSizeWarning: null, rawDiff: null })
    try {
      const raw = await git.getDiff(repoPath, selectedFile ?? undefined)
      set({ rawDiff: raw })
      if (raw.length > DIFF_SIZE_WARN_BYTES) {
        set({ diffSizeWarning: raw.length, diffFiles: [] })
        return
      }
      _diffAbortController?.abort()
      const controller = new AbortController()
      _diffAbortController = controller
      await parseDiffChunked(raw, (files) => set({ diffFiles: files }), controller.signal)
    } catch {
      set({ diffFiles: [] })
    }
  },

  toggleStage: async (filePath) => {
    const { selectedRepo, repos, stagedSet } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    const isStaged = stagedSet.has(filePath)
    try {
      if (isStaged) {
        await git.unstageFiles(repoPath, [filePath])
      } else {
        await git.stageFiles(repoPath, [filePath])
      }
      await get().refresh()
      await get().loadDiff()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Stage/unstage failed' })
    }
  },

  stageAll: async () => {
    const { selectedRepo, repos, files, stagedSet } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    const unstaged = files.filter((f) => !stagedSet.has(f.path)).map((f) => f.path)
    if (unstaged.length === 0) return
    try {
      await git.stageFiles(repoPath, unstaged)
      await get().refresh()
      await get().loadDiff()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Stage all failed' })
    }
  },

  unstageAll: async () => {
    const { selectedRepo, repos, files, stagedSet } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    const staged = files.filter((f) => stagedSet.has(f.path)).map((f) => f.path)
    if (staged.length === 0) return
    try {
      await git.unstageFiles(repoPath, staged)
      await get().refresh()
      await get().loadDiff()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Unstage all failed' })
    }
  },

  commit: async () => {
    const { selectedRepo, repos, commitMsg } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath || !commitMsg.trim()) return
    set({ committing: true, error: null })
    try {
      await git.commit(repoPath, commitMsg.trim())
      set({ commitMsg: '' })
      await get().refresh()
      await get().loadDiff()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Commit failed' })
    } finally {
      set({ committing: false })
    }
  },

  push: async () => {
    const { selectedRepo, repos } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath) return
    set({ pushing: true, pushOutput: null, error: null })
    try {
      const output = await git.push(repoPath)
      set({ pushOutput: output || 'Pushed successfully' })
      await get().refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Push failed'
      set({ error: msg })
      toast.error(msg)
    } finally {
      set({ pushing: false })
    }
  },

  switchBranch: async (branch) => {
    const { selectedRepo, repos, currentBranch } = get()
    const repoPath = selectedRepo ? repos[selectedRepo] : null
    if (!repoPath || branch === currentBranch) return
    try {
      await git.checkout(repoPath, branch)
      await get().refresh()
      await get().loadDiff()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Checkout failed' })
    }
  },

  forceLoadLargeDiff: () => {
    const { rawDiff } = get()
    set({ diffSizeWarning: null })
    if (rawDiff) {
      _diffAbortController?.abort()
      const controller = new AbortController()
      _diffAbortController = controller
      parseDiffChunked(rawDiff, (files) => set({ diffFiles: files }), controller.signal).catch(
        () => {}
      )
    }
  },
}))
