import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('../../../lib/render-markdown', () => ({
  renderMarkdown: (md: string) => md,
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'backlog',
    notes: null,
    spec: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

import { SpecDrawer } from '../SpecDrawer'

describe('SpecDrawer', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSave: vi.fn(),
    onLaunch: vi.fn(),
    onPushToSprint: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render content when task is null', () => {
    render(<SpecDrawer {...defaultProps} task={null} />)
    expect(screen.queryByText('No spec yet')).not.toBeInTheDocument()
  })

  it('shows spec content when task has inline spec', () => {
    const task = makeTask({ spec: '## My Spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)
    expect(screen.getByText('## My Spec')).toBeInTheDocument()
  })

  it('loads spec from file when task.spec is null and prompt contains spec path', async () => {
    const readSpecFile = vi.mocked(window.api.sprint.readSpecFile)
    readSpecFile.mockResolvedValue('# File Spec Content')

    const task = makeTask({ prompt: 'See docs/specs/my-feature.md for details' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await waitFor(() => {
      expect(screen.getByText('# File Spec Content')).toBeInTheDocument()
    })
    expect(readSpecFile).toHaveBeenCalledWith('docs/specs/my-feature.md')
  })

  it('cancels stale spec fetch when task changes rapidly', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void

    const readSpecFile = vi.mocked(window.api.sprint.readSpecFile)

    // First call: slow — will be cancelled
    readSpecFile.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveFirst = resolve })
    )
    // Second call: also deferred so we control timing
    readSpecFile.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveSecond = resolve })
    )

    const taskA = makeTask({
      id: 'task-a',
      prompt: 'See docs/specs/task-a.md',
      spec: null,
    })
    const taskB = makeTask({
      id: 'task-b',
      prompt: 'See docs/specs/task-b.md',
      spec: null,
    })

    // Render with task A — kicks off slow fetch
    const { rerender } = render(<SpecDrawer {...defaultProps} task={taskA} />)

    // Rapidly switch to task B — should cancel task A's fetch
    rerender(<SpecDrawer {...defaultProps} task={taskB} />)

    // Resolve task B first (the current task)
    await act(async () => { resolveSecond('# Task B Spec') })

    await waitFor(() => {
      expect(screen.getByText('# Task B Spec')).toBeInTheDocument()
    })

    // Now the stale task A resolves — should NOT overwrite task B's content
    await act(async () => { resolveFirst('# Task A Spec (STALE)') })

    // Task B content must still be displayed, not task A's stale content
    expect(screen.getByText('# Task B Spec')).toBeInTheDocument()
    expect(screen.queryByText('# Task A Spec (STALE)')).not.toBeInTheDocument()
  })

  it('falls back to prompt when readSpecFile rejects and task is not cancelled', async () => {
    const readSpecFile = vi.mocked(window.api.sprint.readSpecFile)
    readSpecFile.mockRejectedValue(new Error('File not found'))

    const task = makeTask({ prompt: 'See docs/specs/missing.md and do stuff' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await waitFor(() => {
      expect(screen.getByText('See docs/specs/missing.md and do stuff')).toBeInTheDocument()
    })
  })

  it('does not apply error fallback for a cancelled task', async () => {
    let rejectFirst!: (reason: Error) => void

    const readSpecFile = vi.mocked(window.api.sprint.readSpecFile)

    // First call: will reject after task switch
    readSpecFile.mockImplementationOnce(
      () => new Promise<string>((_, reject) => { rejectFirst = reject })
    )

    const taskA = makeTask({
      id: 'task-err-a',
      prompt: 'See docs/specs/task-err-a.md',
      spec: null,
    })
    const taskB = makeTask({
      id: 'task-err-b',
      spec: '# Inline Task B',
    })

    // Render with task A — kicks off fetch
    const { rerender } = render(<SpecDrawer {...defaultProps} task={taskA} />)

    // Switch to task B (inline spec, no fetch needed)
    rerender(<SpecDrawer {...defaultProps} task={taskB} />)

    // Task A's fetch rejects after switch — should be ignored
    await act(async () => { rejectFirst(new Error('File not found')) })

    // Task B's inline content must remain
    expect(screen.getByText('# Inline Task B')).toBeInTheDocument()
  })
})
