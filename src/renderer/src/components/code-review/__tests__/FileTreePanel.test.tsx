import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockSetSelectedDiffFile } = vi.hoisted(() => ({
  mockSetSelectedDiffFile: vi.fn()
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    diffFiles: [],
    selectedDiffFile: null,
    selectedTaskId: null as string | null,
    setSelectedDiffFile: mockSetSelectedDiffFile
  }))
  return { useCodeReviewStore: store }
})

const partnerState = vi.hoisted(() => ({
  reviewByTask: {} as Record<string, { result?: unknown } | undefined>
}))

vi.mock('../../../stores/reviewPartner', () => ({
  useReviewPartnerStore: vi.fn((sel: (s: typeof partnerState) => unknown) => sel(partnerState))
}))

import { FileTreePanel } from '../FileTreePanel'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('FileTreePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeReviewStore.setState({
      diffFiles: [],
      selectedDiffFile: null,
      selectedTaskId: null,
      setSelectedDiffFile: mockSetSelectedDiffFile
    })
    partnerState.reviewByTask = {}
  })

  it('renders header with file count', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, patch: '' },
        { path: 'src/b.ts', status: 'A', additions: 2, deletions: 0, patch: '' }
      ]
    })
    render(<FileTreePanel />)
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders file list with stats', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/index.ts', status: 'M', additions: 10, deletions: 2, patch: '' },
        { path: 'src/new.ts', status: 'A', additions: 50, deletions: 0, patch: '' }
      ]
    })
    render(<FileTreePanel />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('+10 −2')).toBeInTheDocument()
    expect(screen.getByText('src/new.ts')).toBeInTheDocument()
    expect(screen.getByText('+50 −0')).toBeInTheDocument()
  })

  it('calls setSelectedDiffFile when row clicked', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, patch: '' },
        { path: 'src/b.ts', status: 'A', additions: 2, deletions: 1, patch: '' }
      ]
    })
    render(<FileTreePanel />)
    const btn = screen.getByTestId('filetree-row-src/b.ts')
    fireEvent.click(btn)
    expect(mockSetSelectedDiffFile).toHaveBeenCalledWith('src/b.ts')
  })

  it('applies selected modifier class to selected row', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, patch: '' },
        { path: 'src/b.ts', status: 'A', additions: 2, deletions: 1, patch: '' }
      ],
      selectedDiffFile: 'src/b.ts'
    })
    render(<FileTreePanel />)
    const selectedBtn = screen.getByTestId('filetree-row-src/b.ts')
    expect(selectedBtn.className).toContain('cr-filetree__row--selected')
    const unselectedBtn = screen.getByTestId('filetree-row-src/a.ts')
    expect(unselectedBtn.className).not.toContain('cr-filetree__row--selected')
  })

  it('renders status icons for added/deleted/modified files', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'added.ts', status: 'A', additions: 1, deletions: 0, patch: '' },
        { path: 'deleted.ts', status: 'D', additions: 0, deletions: 1, patch: '' },
        { path: 'modified.ts', status: 'M', additions: 1, deletions: 1, patch: '' }
      ]
    })
    const { container } = render(<FileTreePanel />)
    expect(container.querySelector('.cr-file-added')).toBeInTheDocument()
    expect(container.querySelector('.cr-file-deleted')).toBeInTheDocument()
    expect(container.querySelector('.cr-file-modified')).toBeInTheDocument()
  })

  it('renders empty list when no files', () => {
    useCodeReviewStore.setState({ diffFiles: [] })
    render(<FileTreePanel />)
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows issues badge for a file with findings', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      diffFiles: [{ path: 'src/risky.ts', status: 'M', additions: 5, deletions: 0, patch: '' }]
    })
    partnerState.reviewByTask = {
      'task-1': {
        result: {
          findings: {
            perFile: [{ path: 'src/risky.ts', status: 'issues', commentCount: 2, comments: [] }]
          }
        }
      }
    }
    render(<FileTreePanel />)
    expect(screen.getByRole('img', { name: 'File has issues' })).toBeInTheDocument()
  })

  it('shows clean badge for a file with no issues', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      diffFiles: [{ path: 'src/clean.ts', status: 'M', additions: 2, deletions: 0, patch: '' }]
    })
    partnerState.reviewByTask = {
      'task-1': {
        result: {
          findings: {
            perFile: [{ path: 'src/clean.ts', status: 'clean', commentCount: 0, comments: [] }]
          }
        }
      }
    }
    render(<FileTreePanel />)
    expect(screen.getByRole('img', { name: 'File reviewed clean' })).toBeInTheDocument()
  })

  it('shows no badge for unreviewed files', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      diffFiles: [{ path: 'src/unknown.ts', status: 'M', additions: 1, deletions: 0, patch: '' }]
    })
    partnerState.reviewByTask = { 'task-1': { result: { findings: { perFile: [] } } } }
    render(<FileTreePanel />)
    expect(screen.queryByRole('img', { name: /file/i })).not.toBeInTheDocument()
  })
})
