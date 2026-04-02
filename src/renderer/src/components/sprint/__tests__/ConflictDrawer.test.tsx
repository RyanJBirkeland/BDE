import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictDrawer } from '../ConflictDrawer'
import type { SprintTask } from '../../../../../shared/types'

// Mock window.api
beforeEach(() => {
  global.window = {
    api: {
      checkConflictFiles: vi.fn().mockResolvedValue({
        headBranch: 'feature-branch',
        baseBranch: 'main',
        files: ['file1.ts', 'file2.ts']
      }),
      openExternal: vi.fn()
    }
  } as any
})

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    repo: 'my-repo',
    status: 'active',
    pr_url: 'https://github.com/owner/repo/pull/123',
    pr_number: 123,
    pr_status: 'open',
    completed_at: null,
    description: null,
    spec: null,
    branch: null,
    notes: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-20T12:00:00Z',
    started_at: null,
    depends_on: [],
    claimed_by: null,
    agent_run_id: null,
    priority: 0,
    fast_fail_count: 0,
    max_runtime_ms: null,
    ...overrides
  } as SprintTask
}

function makeProps(overrides: Partial<Parameters<typeof ConflictDrawer>[0]> = {}) {
  return {
    open: true,
    tasks: [makeTask({ id: 'task-1', title: 'First Task' })],
    onClose: vi.fn(),
    ...overrides
  }
}

describe('ConflictDrawer', () => {
  it('renders title with task count when open', () => {
    render(<ConflictDrawer {...makeProps()} />)
    expect(screen.getByText('Merge Conflicts')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders all task titles', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Alpha Conflict' }),
      makeTask({ id: '2', title: 'Beta Conflict' })
    ]
    render(<ConflictDrawer {...makeProps({ tasks })} />)
    expect(screen.getByText('Alpha Conflict')).toBeInTheDocument()
    expect(screen.getByText('Beta Conflict')).toBeInTheDocument()
  })

  it('calls onClose when overlay clicked', () => {
    const props = makeProps()
    render(<ConflictDrawer {...props} />)
    const overlay = document.querySelector('.conflict-drawer__overlay')
    expect(overlay).toBeTruthy()
    fireEvent.click(overlay!)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button clicked', () => {
    const props = makeProps()
    render(<ConflictDrawer {...props} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows empty state when no tasks', () => {
    render(<ConflictDrawer {...makeProps({ tasks: [] })} />)
    expect(screen.getByText('No merge conflicts detected.')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<ConflictDrawer {...makeProps({ open: false })} />)
    const overlay = document.querySelector('.conflict-drawer__overlay')
    expect(overlay).not.toBeInTheDocument()
  })
})
