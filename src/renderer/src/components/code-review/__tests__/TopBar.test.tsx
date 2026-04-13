import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopBar } from '../TopBar'
import { useCodeReviewStore } from '../../../stores/codeReview'
import { useSprintTasks } from '../../../stores/sprintTasks'
import type { SprintTask } from '../../../../../shared/types/task-types'

vi.mock('../../../hooks/useGitHubStatus', () => ({
  useGitHubStatus: () => ({ configured: true })
}))

vi.mock('../ReviewQueue', () => ({
  ReviewQueue: () => <div data-testid="review-queue">Queue</div>
}))

vi.mock('../../../stores/reviewPartner', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    panelOpen: false,
    togglePanel: vi.fn(),
    reviewByTask: {} as Record<string, { status: string; result?: unknown }>
  }))
  return { useReviewPartnerStore: store }
})

import { useReviewPartnerStore } from '../../../stores/reviewPartner'

const TASK_1: SprintTask = {
  id: 'task-1',
  title: 'Test Task 1',
  status: 'review',
  repo: 'bde',
  spec: 'Test spec',
  spec_type: 'spec',
  updated_at: '2026-04-11T00:00:00Z',
  priority: 1,
  needs_review: true,
  playground_enabled: false,
  prompt: null,
  notes: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null
} as SprintTask

describe('TopBar', () => {
  beforeEach(() => {
    useCodeReviewStore.getState().reset()
    useSprintTasks.setState({ tasks: [TASK_1] })
    useCodeReviewStore.getState().selectTask('task-1')
    useReviewPartnerStore.setState({ reviewByTask: {} })
    window.api = {
      review: {
        checkFreshness: vi.fn().mockResolvedValue({ status: 'fresh', commitsBehind: 0 })
      }
    } as never
  })

  it('should render with selected task', () => {
    render(<TopBar />)
    expect(screen.getByText('Test Task 1')).toBeInTheDocument()
  })

  it('should render AI Partner toggle button', () => {
    render(<TopBar />)
    expect(screen.getByRole('button', { name: 'Toggle AI Review Partner' })).toBeInTheDocument()
  })

  it('should render Approve dropdown trigger', () => {
    render(<TopBar />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
  })

  it('should show action buttons inside Approve dropdown', async () => {
    const user = userEvent.setup()
    render(<TopBar />)
    // Click the Approve trigger to open the dropdown
    const approveBtn = screen.getByRole('button', { name: /approve/i })
    await user.click(approveBtn)
    // All consolidated actions appear as menuitems
    expect(screen.getByRole('menuitem', { name: /Merge Locally/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Create PR/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Request Revision/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Discard/i })).toBeInTheDocument()
  })

  it('should show Ship It as Squash & Merge inside Approve dropdown', async () => {
    const user = userEvent.setup()
    render(<TopBar />)
    const approveBtn = screen.getByRole('button', { name: /approve/i })
    await user.click(approveBtn)
    // Ship It functionality maps to Squash & Merge in the consolidated dropdown
    expect(screen.getByRole('menuitem', { name: /Squash & Merge/i })).toBeInTheDocument()
  })

  it('should show freshness badge', async () => {
    render(<TopBar />)
    await waitFor(() => {
      expect(screen.getByText('Fresh')).toBeInTheDocument()
    })
  })

  it('should open task switcher popover on click', async () => {
    const user = userEvent.setup()
    render(<TopBar />)
    const taskBtn = screen.getByRole('button', { name: /Test Task 1/i })
    await user.click(taskBtn)
    expect(screen.getByTestId('review-queue')).toBeInTheDocument()
  })

  it('should show BranchBar with real branch name from review result', () => {
    useReviewPartnerStore.setState({
      reviewByTask: {
        'task-1': {
          status: 'ready',
          result: {
            qualityScore: 92,
            issuesCount: 3,
            filesCount: 8,
            openingMessage: 'ok',
            findings: { perFile: [], branch: 'feat/fix-auth' },
            model: 'claude-opus-4-6',
            createdAt: 0
          }
        }
      }
    })
    render(<TopBar />)
    expect(screen.getByText('feat/fix-auth')).toBeInTheDocument()
  })

  it('should not show BranchBar when review result has no branch yet', () => {
    useReviewPartnerStore.setState({ reviewByTask: {} })
    render(<TopBar />)
    // No branch text — BranchBar is not rendered
    expect(screen.queryByText(/feat\//)).not.toBeInTheDocument()
  })

  it('should auto-select first review task when selection is cleared', async () => {
    useCodeReviewStore.getState().selectTask(null)
    render(<TopBar />)
    await waitFor(() => {
      expect(screen.getByText('Test Task 1')).toBeInTheDocument()
    })
    expect(useCodeReviewStore.getState().selectedTaskId).toBe('task-1')
  })

  it('should show "No tasks in review" hint when nothing is in review', () => {
    useSprintTasks.setState({ tasks: [] })
    useCodeReviewStore.getState().selectTask(null)
    render(<TopBar />)
    expect(screen.getByText(/No tasks in review/i)).toBeInTheDocument()
  })

  it('should show batch mode when tasks are selected', () => {
    useSprintTasks.setState({
      tasks: [
        {
          ...TASK_1,
          id: 'task-1',
          title: 'Task 1'
        } as SprintTask,
        {
          ...TASK_1,
          id: 'task-2',
          title: 'Task 2'
        } as SprintTask
      ]
    })
    const batchIds = new Set(['task-1', 'task-2'])
    useCodeReviewStore.setState({ selectedBatchIds: batchIds })
    render(<TopBar />)
    expect(screen.getByText('2 tasks selected')).toBeInTheDocument()
    expect(screen.getByText('Merge All')).toBeInTheDocument()
    expect(screen.getByText('Ship All')).toBeInTheDocument()
    expect(screen.getByText('Create PRs')).toBeInTheDocument()
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  it('should clear batch selection when Clear is clicked', async () => {
    const user = userEvent.setup()
    useSprintTasks.setState({
      tasks: [{ ...TASK_1, id: 'task-1', title: 'Task 1' } as SprintTask]
    })
    const batchIds = new Set(['task-1'])
    useCodeReviewStore.setState({ selectedBatchIds: batchIds })
    render(<TopBar />)
    const clearBtn = screen.getByText('Clear')
    await user.click(clearBtn)
    expect(useCodeReviewStore.getState().selectedBatchIds.size).toBe(0)
  })
})
