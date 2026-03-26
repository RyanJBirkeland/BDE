import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    undoable: vi.fn()
  }
}))

// Mock window.api
const mockApi = {
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckout: vi.fn(),
  getRepoPaths: vi.fn()
}

vi.stubGlobal('window', { api: mockApi })

import { useGitTreeStore } from '../gitTree'
import { toast } from '../toasts'

// IPC structured response for git:status
const GIT_STATUS_RESULT = {
  files: [
    { path: 'src/foo.ts', status: 'M', staged: true },
    { path: 'src/added.ts', status: 'A', staged: true },
    { path: 'src/bar.ts', status: 'M', staged: false },
    { path: 'src/new.ts', status: '?', staged: false }
  ]
}

describe('useGitTreeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitTreeStore.setState({
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
      branches: []
    })
  })

  describe('fetchStatus', () => {
    it('populates staged, unstaged, and untracked from structured IPC result', async () => {
      mockApi.gitStatus.mockResolvedValue(GIT_STATUS_RESULT)
      await useGitTreeStore.getState().fetchStatus('/repo')

      const state = useGitTreeStore.getState()
      expect(state.staged).toEqual(
        expect.arrayContaining([
          { path: 'src/foo.ts', status: 'M' },
          { path: 'src/added.ts', status: 'A' }
        ])
      )
      expect(state.unstaged).toEqual([{ path: 'src/bar.ts', status: 'M' }])
      expect(state.untracked).toEqual([{ path: 'src/new.ts', status: '?' }])
      expect(state.loading).toBe(false)
    })

    it('handles empty files array', async () => {
      mockApi.gitStatus.mockResolvedValue({ files: [] })
      await useGitTreeStore.getState().fetchStatus('/repo')

      const state = useGitTreeStore.getState()
      expect(state.staged).toEqual([])
      expect(state.unstaged).toEqual([])
      expect(state.untracked).toEqual([])
    })

    it('shows error toast on failure', async () => {
      mockApi.gitStatus.mockRejectedValue(new Error('git error'))
      await useGitTreeStore.getState().fetchStatus('/repo')

      expect(toast.error).toHaveBeenCalledWith('Failed to fetch git status')
      expect(useGitTreeStore.getState().loading).toBe(false)
    })
  })

  describe('selectFile', () => {
    beforeEach(() => {
      useGitTreeStore.setState({
        staged: [{ path: 'src/foo.ts', status: 'M' }],
        unstaged: [{ path: 'src/bar.ts', status: 'M' }],
        untracked: [{ path: 'src/new.ts', status: '?' }]
      })
    })

    it('sets selectedFile and fetches diff for staged file', async () => {
      mockApi.gitDiff.mockResolvedValue('diff content')
      await useGitTreeStore.getState().selectFile('/repo', 'src/foo.ts', true)

      const state = useGitTreeStore.getState()
      expect(state.selectedFile).toEqual({ path: 'src/foo.ts', status: 'M' })
      expect(state.selectedStaged).toBe(true)
      expect(state.diffContent).toBe('diff content')
    })

    it('sets selectedFile for unstaged file', async () => {
      mockApi.gitDiff.mockResolvedValue('unstaged diff')
      await useGitTreeStore.getState().selectFile('/repo', 'src/bar.ts', false)

      const state = useGitTreeStore.getState()
      expect(state.selectedFile).toEqual({ path: 'src/bar.ts', status: 'M' })
      expect(state.selectedStaged).toBe(false)
    })

    it('does nothing when file not found', async () => {
      await useGitTreeStore.getState().selectFile('/repo', 'nonexistent.ts', false)
      expect(useGitTreeStore.getState().selectedFile).toBeNull()
    })
  })

  describe('clearSelection', () => {
    it('clears selectedFile and diffContent', () => {
      useGitTreeStore.setState({
        selectedFile: { path: 'foo.ts', status: 'M' },
        diffContent: 'some diff',
        selectedStaged: true
      })
      useGitTreeStore.getState().clearSelection()

      const state = useGitTreeStore.getState()
      expect(state.selectedFile).toBeNull()
      expect(state.diffContent).toBe('')
      expect(state.selectedStaged).toBe(false)
    })
  })

  describe('stageFile', () => {
    it('calls gitStage and refreshes status', async () => {
      mockApi.gitStage.mockResolvedValue(undefined)
      mockApi.gitStatus.mockResolvedValue({ files: [] })

      await useGitTreeStore.getState().stageFile('/repo', 'src/foo.ts')

      expect(mockApi.gitStage).toHaveBeenCalledWith('/repo', ['src/foo.ts'])
      expect(mockApi.gitStatus).toHaveBeenCalled()
    })

    it('shows error toast on failure', async () => {
      mockApi.gitStage.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().stageFile('/repo', 'src/foo.ts')

      expect(toast.error).toHaveBeenCalledWith('Failed to stage src/foo.ts')
    })
  })

  describe('unstageFile', () => {
    it('calls gitUnstage and refreshes status', async () => {
      mockApi.gitUnstage.mockResolvedValue(undefined)
      mockApi.gitStatus.mockResolvedValue({ files: [] })

      await useGitTreeStore.getState().unstageFile('/repo', 'src/foo.ts')

      expect(mockApi.gitUnstage).toHaveBeenCalledWith('/repo', ['src/foo.ts'])
    })

    it('shows error toast on failure', async () => {
      mockApi.gitUnstage.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().unstageFile('/repo', 'src/foo.ts')

      expect(toast.error).toHaveBeenCalledWith('Failed to unstage src/foo.ts')
    })
  })

  describe('stageAll', () => {
    it('stages all unstaged and untracked files', async () => {
      useGitTreeStore.setState({
        unstaged: [{ path: 'a.ts', status: 'M' }],
        untracked: [{ path: 'b.ts', status: '?' }]
      })
      mockApi.gitStage.mockResolvedValue(undefined)
      mockApi.gitStatus.mockResolvedValue({ files: [] })

      await useGitTreeStore.getState().stageAll('/repo')

      expect(mockApi.gitStage).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts'])
    })

    it('does nothing when no files to stage', async () => {
      useGitTreeStore.setState({ unstaged: [], untracked: [] })
      await useGitTreeStore.getState().stageAll('/repo')
      expect(mockApi.gitStage).not.toHaveBeenCalled()
    })
  })

  describe('unstageAll', () => {
    it('unstages all staged files', async () => {
      useGitTreeStore.setState({
        staged: [
          { path: 'a.ts', status: 'M' },
          { path: 'b.ts', status: 'A' }
        ]
      })
      mockApi.gitUnstage.mockResolvedValue(undefined)
      mockApi.gitStatus.mockResolvedValue({ files: [] })

      await useGitTreeStore.getState().unstageAll('/repo')

      expect(mockApi.gitUnstage).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts'])
    })

    it('does nothing when no staged files', async () => {
      useGitTreeStore.setState({ staged: [] })
      await useGitTreeStore.getState().unstageAll('/repo')
      expect(mockApi.gitUnstage).not.toHaveBeenCalled()
    })
  })

  describe('setCommitMessage', () => {
    it('updates commitMessage', () => {
      useGitTreeStore.getState().setCommitMessage('feat: new feature')
      expect(useGitTreeStore.getState().commitMessage).toBe('feat: new feature')
    })
  })

  describe('commit', () => {
    it('commits and clears message on success', async () => {
      useGitTreeStore.setState({
        commitMessage: 'feat: test',
        staged: [{ path: 'foo.ts', status: 'M' }]
      })
      mockApi.gitCommit.mockResolvedValue(undefined)
      mockApi.gitStatus.mockResolvedValue({ files: [] })

      await useGitTreeStore.getState().commit('/repo')

      expect(mockApi.gitCommit).toHaveBeenCalledWith('/repo', 'feat: test')
      expect(useGitTreeStore.getState().commitMessage).toBe('')
      expect(toast.success).toHaveBeenCalledWith('Committed successfully')
    })

    it('does nothing when message is empty', async () => {
      useGitTreeStore.setState({
        commitMessage: '',
        staged: [{ path: 'foo.ts', status: 'M' }]
      })
      await useGitTreeStore.getState().commit('/repo')
      expect(mockApi.gitCommit).not.toHaveBeenCalled()
    })

    it('does nothing when no staged files', async () => {
      useGitTreeStore.setState({ commitMessage: 'msg', staged: [] })
      await useGitTreeStore.getState().commit('/repo')
      expect(mockApi.gitCommit).not.toHaveBeenCalled()
    })

    it('shows error toast on failure', async () => {
      useGitTreeStore.setState({
        commitMessage: 'msg',
        staged: [{ path: 'foo.ts', status: 'M' }]
      })
      mockApi.gitCommit.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().commit('/repo')

      expect(toast.error).toHaveBeenCalledWith('Commit failed')
    })
  })

  describe('push', () => {
    it('calls gitPush and shows success toast', async () => {
      mockApi.gitPush.mockResolvedValue(undefined)
      await useGitTreeStore.getState().push('/repo')

      expect(mockApi.gitPush).toHaveBeenCalledWith('/repo')
      expect(toast.success).toHaveBeenCalledWith('Pushed successfully')
    })

    it('shows error toast on failure', async () => {
      mockApi.gitPush.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().push('/repo')
      expect(toast.error).toHaveBeenCalledWith('Push failed')
    })
  })

  describe('fetchBranches', () => {
    it('loads branches and current branch from api', async () => {
      mockApi.gitBranches.mockResolvedValue({ current: 'main', branches: ['main', 'feat/test'] })
      await useGitTreeStore.getState().fetchBranches('/repo')

      const state = useGitTreeStore.getState()
      expect(state.branches).toEqual(['main', 'feat/test'])
      expect(state.branch).toBe('main')
    })

    it('sets empty array on failure', async () => {
      mockApi.gitBranches.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().fetchBranches('/repo')
      expect(useGitTreeStore.getState().branches).toEqual([])
    })
  })

  describe('setActiveRepo', () => {
    it('sets activeRepo', () => {
      useGitTreeStore.getState().setActiveRepo('/some/repo')
      expect(useGitTreeStore.getState().activeRepo).toBe('/some/repo')
    })
  })

  describe('loadRepoPaths', () => {
    it('loads repo paths from Record<name, path> and sets first as active when none selected', async () => {
      mockApi.getRepoPaths.mockResolvedValue({ bde: '/repo/a', 'life-os': '/repo/b' })
      await useGitTreeStore.getState().loadRepoPaths()

      const state = useGitTreeStore.getState()
      expect(state.repoPaths).toEqual(['/repo/a', '/repo/b'])
      expect(state.activeRepo).toBe('/repo/a')
    })

    it('does not override existing activeRepo', async () => {
      useGitTreeStore.setState({ activeRepo: '/repo/b' })
      mockApi.getRepoPaths.mockResolvedValue({ bde: '/repo/a', 'life-os': '/repo/b' })
      await useGitTreeStore.getState().loadRepoPaths()

      expect(useGitTreeStore.getState().activeRepo).toBe('/repo/b')
    })

    it('handles api failure gracefully', async () => {
      mockApi.getRepoPaths.mockRejectedValue(new Error('fail'))
      await useGitTreeStore.getState().loadRepoPaths()
      expect(useGitTreeStore.getState().repoPaths).toEqual([])
    })
  })
})
