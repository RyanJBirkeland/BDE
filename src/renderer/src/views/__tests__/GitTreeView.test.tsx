import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock stores and hooks
vi.mock('../../stores/gitTree', () => ({
  useGitTreeStore: vi.fn(),
}))

vi.mock('../../hooks/useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn(),
}))

// Mock sub-components to isolate GitTreeView
vi.mock('../../components/git-tree/CommitBox', () => ({
  CommitBox: ({
    commitMessage,
    stagedCount,
    onCommit,
    onPush,
    onMessageChange,
  }: {
    commitMessage: string
    stagedCount: number
    onCommit: () => void
    onPush: () => void
    onMessageChange: (m: string) => void
  }) => (
    <div data-testid="commit-box">
      <span data-testid="staged-count">{stagedCount}</span>
      <input
        data-testid="commit-input"
        value={commitMessage}
        onChange={(e) => onMessageChange(e.target.value)}
      />
      <button data-testid="commit-btn" onClick={onCommit}>
        Commit
      </button>
      <button data-testid="push-btn" onClick={onPush}>
        Push
      </button>
    </div>
  ),
}))

vi.mock('../../components/git-tree/FileTreeSection', () => ({
  FileTreeSection: ({
    title,
    files,
  }: {
    title: string
    files: { path: string; status: string }[]
  }) =>
    files.length > 0 ? (
      <div data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        {title}: {files.length}
      </div>
    ) : null,
}))

vi.mock('../../components/git-tree/BranchSelector', () => ({
  BranchSelector: ({ currentBranch }: { currentBranch: string }) => (
    <div data-testid="branch-selector">{currentBranch}</div>
  ),
}))

vi.mock('../../components/git-tree/InlineDiffDrawer', () => ({
  InlineDiffDrawer: ({
    selectedFile,
    onClose,
  }: {
    selectedFile: { path: string } | null
    onClose: () => void
  }) =>
    selectedFile ? (
      <div data-testid="inline-diff">
        <span>{selectedFile.path}</span>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}))

import GitTreeView from '../GitTreeView'
import { useGitTreeStore } from '../../stores/gitTree'

const mockStoreState = {
  branch: 'main',
  staged: [],
  unstaged: [],
  untracked: [],
  loading: false,
  selectedFile: null,
  diffContent: '',
  commitMessage: '',
  repoPaths: ['/repo/bde'],
  activeRepo: '/repo/bde',
  branches: ['main', 'feat/test'],
  fetchStatus: vi.fn(),
  selectFile: vi.fn(),
  clearSelection: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  stageAll: vi.fn(),
  unstageAll: vi.fn(),
  setCommitMessage: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  fetchBranches: vi.fn(),
  setActiveRepo: vi.fn(),
  loadRepoPaths: vi.fn(),
}

describe('GitTreeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Set up store mock — getState returns the full state object with actions
    const storeGetState = vi.fn(() => mockStoreState)
    vi.mocked(useGitTreeStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector(mockStoreState as any)
      }
      return mockStoreState as any
    })
    ;(useGitTreeStore as any).getState = storeGetState
  })

  describe('Basic rendering', () => {
    it('renders Source Control heading', () => {
      render(<GitTreeView />)
      expect(screen.getByText('Source Control')).toBeInTheDocument()
    })

    it('renders BranchSelector with current branch', () => {
      render(<GitTreeView />)
      expect(screen.getByTestId('branch-selector')).toBeInTheDocument()
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    it('renders CommitBox', () => {
      render(<GitTreeView />)
      expect(screen.getByTestId('commit-box')).toBeInTheDocument()
    })

    it('shows refresh button', () => {
      render(<GitTreeView />)
      expect(screen.getByLabelText('Refresh git status')).toBeInTheDocument()
    })

    it('calls loadRepoPaths on mount', () => {
      render(<GitTreeView />)
      expect(mockStoreState.loadRepoPaths).toHaveBeenCalled()
    })
  })

  describe('Empty states', () => {
    it('shows empty state when no changes exist', () => {
      render(<GitTreeView />)
      expect(screen.getByText('No changes')).toBeInTheDocument()
    })

    it('hides empty state when staged files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            staged: [{ path: 'foo.ts', status: 'M' }],
          } as any)
        }
        return { ...mockStoreState, staged: [{ path: 'foo.ts', status: 'M' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.queryByText('No changes')).not.toBeInTheDocument()
    })

    it('hides empty state when unstaged files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            unstaged: [{ path: 'bar.ts', status: 'M' }],
          } as any)
        }
        return { ...mockStoreState, unstaged: [{ path: 'bar.ts', status: 'M' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.queryByText('No changes')).not.toBeInTheDocument()
    })

    it('hides empty state when untracked files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            untracked: [{ path: 'new.ts', status: '?' }],
          } as any)
        }
        return { ...mockStoreState, untracked: [{ path: 'new.ts', status: '?' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.queryByText('No changes')).not.toBeInTheDocument()
    })

    it('does not show empty state when loading', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            loading: true,
          } as any)
        }
        return { ...mockStoreState, loading: true } as any
      })

      render(<GitTreeView />)
      expect(screen.queryByText('No changes')).not.toBeInTheDocument()
    })
  })

  describe('Loading states', () => {
    it('disables refresh button when loading', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            loading: true,
          } as any)
        }
        return { ...mockStoreState, loading: true } as any
      })

      render(<GitTreeView />)
      const refreshBtn = screen.getByLabelText('Refresh git status')
      expect(refreshBtn).toBeDisabled()
    })

    it('enables refresh button when not loading', () => {
      render(<GitTreeView />)
      const refreshBtn = screen.getByLabelText('Refresh git status')
      expect(refreshBtn).not.toBeDisabled()
    })

    it('shows spinning animation on refresh icon when loading', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            loading: true,
          } as any)
        }
        return { ...mockStoreState, loading: true } as any
      })

      const { container } = render(<GitTreeView />)
      const refreshIcon = container.querySelector('[style*="animation"]')
      expect(refreshIcon).toBeInTheDocument()
    })
  })

  describe('Conditional file sections', () => {
    it('renders staged section when staged files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            staged: [{ path: 'foo.ts', status: 'M' }],
          } as any)
        }
        return { ...mockStoreState, staged: [{ path: 'foo.ts', status: 'M' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('section-staged-changes')).toBeInTheDocument()
    })

    it('renders changes section when unstaged files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            unstaged: [{ path: 'bar.ts', status: 'M' }],
          } as any)
        }
        return { ...mockStoreState, unstaged: [{ path: 'bar.ts', status: 'M' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('section-changes')).toBeInTheDocument()
    })

    it('renders changes section when only untracked files exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            untracked: [{ path: 'new.ts', status: '?' }],
          } as any)
        }
        return { ...mockStoreState, untracked: [{ path: 'new.ts', status: '?' }] } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('section-changes')).toBeInTheDocument()
    })

    it('merges unstaged and untracked files in changes section', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            unstaged: [{ path: 'modified.ts', status: 'M' }],
            untracked: [{ path: 'new.ts', status: '?' }],
          } as any)
        }
        return {
          ...mockStoreState,
          unstaged: [{ path: 'modified.ts', status: 'M' }],
          untracked: [{ path: 'new.ts', status: '?' }],
        } as any
      })

      render(<GitTreeView />)
      const changesSection = screen.getByTestId('section-changes')
      expect(changesSection).toHaveTextContent('Changes: 2')
    })

    it('renders both staged and unstaged sections when both exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            staged: [{ path: 'staged.ts', status: 'M' }],
            unstaged: [{ path: 'unstaged.ts', status: 'M' }],
          } as any)
        }
        return {
          ...mockStoreState,
          staged: [{ path: 'staged.ts', status: 'M' }],
          unstaged: [{ path: 'unstaged.ts', status: 'M' }],
        } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('section-staged-changes')).toBeInTheDocument()
      expect(screen.getByTestId('section-changes')).toBeInTheDocument()
    })
  })

  describe('Diff drawer conditional rendering', () => {
    it('renders InlineDiffDrawer when a file is selected', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            selectedFile: { path: 'src/foo.ts', status: 'M' },
            diffContent: 'some diff',
          } as any)
        }
        return {
          ...mockStoreState,
          selectedFile: { path: 'src/foo.ts', status: 'M' },
          diffContent: 'some diff',
        } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('inline-diff')).toBeInTheDocument()
      expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
    })

    it('does not render InlineDiffDrawer when no file selected', () => {
      render(<GitTreeView />)
      expect(screen.queryByTestId('inline-diff')).not.toBeInTheDocument()
    })
  })

  describe('Repository selector', () => {
    it('shows repo selector when multiple repos exist', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            repoPaths: ['/repo/bde', '/repo/other'],
          } as any)
        }
        return { ...mockStoreState, repoPaths: ['/repo/bde', '/repo/other'] } as any
      })

      render(<GitTreeView />)
      expect(screen.getByLabelText('Select repository')).toBeInTheDocument()
    })

    it('does not show repo selector when only one repo', () => {
      render(<GitTreeView />)
      expect(screen.queryByLabelText('Select repository')).not.toBeInTheDocument()
    })

    it('does not show repo selector when no repos', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            repoPaths: [],
          } as any)
        }
        return { ...mockStoreState, repoPaths: [] } as any
      })

      render(<GitTreeView />)
      expect(screen.queryByLabelText('Select repository')).not.toBeInTheDocument()
    })
  })

  describe('Staged count in CommitBox', () => {
    it('passes correct staged count to CommitBox', () => {
      vi.mocked(useGitTreeStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            ...mockStoreState,
            staged: [
              { path: 'foo.ts', status: 'M' },
              { path: 'bar.ts', status: 'A' },
              { path: 'baz.ts', status: 'D' },
            ],
          } as any)
        }
        return {
          ...mockStoreState,
          staged: [
            { path: 'foo.ts', status: 'M' },
            { path: 'bar.ts', status: 'A' },
            { path: 'baz.ts', status: 'D' },
          ],
        } as any
      })

      render(<GitTreeView />)
      expect(screen.getByTestId('staged-count')).toHaveTextContent('3')
    })

    it('shows zero staged count when no staged files', () => {
      render(<GitTreeView />)
      expect(screen.getByTestId('staged-count')).toHaveTextContent('0')
    })
  })
})
