import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffViewerPanel } from '../DiffViewerPanel'
import { useCodeReviewStore } from '../../../stores/codeReview'

vi.mock('../ChangesTab', () => ({
  ChangesTab: () => <div data-testid="changes-tab">Changes</div>
}))

vi.mock('../CommitsTab', () => ({
  CommitsTab: () => <div data-testid="commits-tab">Commits</div>
}))

vi.mock('../TestsTab', () => ({
  TestsTab: () => <div data-testid="tests-tab">Tests</div>
}))

const partnerState = vi.hoisted(() => ({
  reviewByTask: {} as Record<string, { result?: unknown } | undefined>
}))

vi.mock('../../../stores/reviewPartner', () => ({
  useReviewPartnerStore: vi.fn((sel: (s: typeof partnerState) => unknown) => sel(partnerState))
}))

describe('DiffViewerPanel', () => {
  beforeEach(() => {
    useCodeReviewStore.getState().reset()
    partnerState.reviewByTask = {}
  })

  it('should render Changes tab by default', () => {
    render(<DiffViewerPanel />)
    expect(screen.getByTestId('changes-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('commits-tab')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tests-tab')).not.toBeInTheDocument()
  })

  it('should show Commits tab when mode is commits', () => {
    useCodeReviewStore.getState().setDiffMode('commits')
    render(<DiffViewerPanel />)
    expect(screen.getByTestId('commits-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('changes-tab')).not.toBeInTheDocument()
  })

  it('should show Tests tab when mode is tests', () => {
    useCodeReviewStore.getState().setDiffMode('tests')
    render(<DiffViewerPanel />)
    expect(screen.getByTestId('tests-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('changes-tab')).not.toBeInTheDocument()
  })

  it('should switch to Commits mode on pill click', async () => {
    const user = userEvent.setup()
    render(<DiffViewerPanel />)
    const commitsPill = screen.getByRole('button', { name: 'Commits' })
    await user.click(commitsPill)
    expect(screen.getByTestId('commits-tab')).toBeInTheDocument()
  })

  it('should show selected file path in breadcrumb', () => {
    useCodeReviewStore.getState().setSelectedDiffFile('src/renderer/src/App.tsx')
    render(<DiffViewerPanel />)
    expect(screen.getByText('src/renderer/src/App.tsx')).toBeInTheDocument()
  })

  it('should show placeholder when no file selected', () => {
    render(<DiffViewerPanel />)
    expect(screen.getByText('Select a file to view diff')).toBeInTheDocument()
  })

  it('should render all three mode pills', () => {
    render(<DiffViewerPanel />)
    expect(screen.getByRole('button', { name: 'Diff' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commits' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tests' })).toBeInTheDocument()
  })

  it('should show AIReviewedBadge when a finding exists for selected file', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      selectedDiffFile: 'src/foo.ts'
    })
    partnerState.reviewByTask = {
      'task-1': {
        result: {
          findings: {
            perFile: [{ path: 'src/foo.ts', status: 'issues', commentCount: 3, comments: [] }]
          }
        }
      }
    }
    render(<DiffViewerPanel />)
    expect(screen.getByLabelText('AI reviewed — 3 comments')).toBeInTheDocument()
  })

  it('should not show AIReviewedBadge when no finding for selected file', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      selectedDiffFile: 'src/foo.ts'
    })
    partnerState.reviewByTask = {
      'task-1': {
        result: {
          findings: { perFile: [] }
        }
      }
    }
    render(<DiffViewerPanel />)
    expect(screen.queryByLabelText(/AI reviewed/i)).not.toBeInTheDocument()
  })

  it('should not show AIReviewedBadge when no file selected', () => {
    useCodeReviewStore.setState({
      selectedTaskId: 'task-1',
      selectedDiffFile: null
    })
    partnerState.reviewByTask = {
      'task-1': {
        result: {
          findings: {
            perFile: [{ path: 'src/foo.ts', status: 'clean', commentCount: 0, comments: [] }]
          }
        }
      }
    }
    render(<DiffViewerPanel />)
    expect(screen.queryByLabelText(/AI reviewed/i)).not.toBeInTheDocument()
  })
})
