import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('../../../lib/render-markdown', () => ({
  renderMarkdown: (md: string) => md
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const { createElement } = require('react')
      return createElement('div', props, children)
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { scaleIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
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
    retry_count: 0,
    fast_fail_count: 0,
    template_name: null,
    depends_on: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides
  }
}

import { SpecDrawer } from '../SpecDrawer'

describe('SpecDrawer', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSave: vi.fn(),
    onLaunch: vi.fn(),
    onPushToSprint: vi.fn()
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

    readSpecFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve
        })
    )
    readSpecFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        })
    )

    const taskA = makeTask({
      id: 'task-a',
      prompt: 'See docs/specs/task-a.md',
      spec: null
    })
    const taskB = makeTask({
      id: 'task-b',
      prompt: 'See docs/specs/task-b.md',
      spec: null
    })

    const { rerender } = render(<SpecDrawer {...defaultProps} task={taskA} />)
    rerender(<SpecDrawer {...defaultProps} task={taskB} />)

    await act(async () => {
      resolveSecond('# Task B Spec')
    })

    await waitFor(() => {
      expect(screen.getByText('# Task B Spec')).toBeInTheDocument()
    })

    await act(async () => {
      resolveFirst('# Task A Spec (STALE)')
    })

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

  it('shows Edit button in view mode', () => {
    const task = makeTask({ spec: '## My Spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('clicking Edit button switches to edit mode (shows Save and Cancel)', async () => {
    const user = userEvent.setup()
    const task = makeTask({ spec: '## My Spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('clicking Cancel reverts to view mode without saving', async () => {
    const user = userEvent.setup()
    const task = makeTask({ spec: 'Original spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(defaultProps.onSave).not.toHaveBeenCalled()
  })

  it('clicking Save calls onSave with task id and draft content', async () => {
    const user = userEvent.setup()
    const task = makeTask({ spec: '## Original' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(defaultProps.onSave).toHaveBeenCalledWith(task.id, '## Original')
  })

  it('shows toast on save', async () => {
    const { toast } = await import('../../../stores/toasts')
    const user = userEvent.setup()
    const task = makeTask({ spec: '## Content' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(toast.success).toHaveBeenCalledWith('Spec saved')
  })

  it('shows Push to Sprint button for backlog tasks with no spec', () => {
    const task = makeTask({ status: 'backlog', spec: null })
    render(<SpecDrawer {...defaultProps} task={task} />)
    expect(screen.getByRole('button', { name: /Push to Sprint/ })).toBeInTheDocument()
  })

  it('shows Launch button for backlog tasks with spec', () => {
    const task = makeTask({ status: 'backlog', spec: '## Spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)
    expect(screen.getByRole('button', { name: 'Launch' })).toBeInTheDocument()
  })

  it('shows Launch Agent button for queued tasks', () => {
    const task = makeTask({ status: 'queued' })
    render(<SpecDrawer {...defaultProps} task={task} />)
    expect(screen.getByRole('button', { name: 'Launch Agent' })).toBeInTheDocument()
  })

  it('shows Mark Done button when onMarkDone is provided and task is not done', () => {
    const task = makeTask({ status: 'active' })
    render(<SpecDrawer {...defaultProps} task={task} onMarkDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Mark Done/ })).toBeInTheDocument()
  })

  it('does not show Mark Done button when task is already done', () => {
    const task = makeTask({ status: 'done' })
    render(<SpecDrawer {...defaultProps} task={task} onMarkDone={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Mark Done/ })).not.toBeInTheDocument()
  })

  it('shows Delete button when onDelete is provided', () => {
    const task = makeTask()
    render(<SpecDrawer {...defaultProps} task={task} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument()
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const task = makeTask({ spec: '## Spec' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    await user.click(screen.getByTitle('Close'))

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('shows prompt toggle button when task has prompt', async () => {
    const user = userEvent.setup()
    const task = makeTask({ prompt: 'My full prompt text' })
    render(<SpecDrawer {...defaultProps} task={task} />)

    expect(screen.getByText(/View Full Prompt/)).toBeInTheDocument()
    await user.click(screen.getByText(/View Full Prompt/))
    expect(screen.getAllByText('My full prompt text').length).toBeGreaterThanOrEqual(1)
  })

  it('does not apply error fallback for a cancelled task', async () => {
    let rejectFirst!: (reason: Error) => void

    const readSpecFile = vi.mocked(window.api.sprint.readSpecFile)

    readSpecFile.mockImplementationOnce(
      () =>
        new Promise<string>((_, reject) => {
          rejectFirst = reject
        })
    )

    const taskA = makeTask({
      id: 'task-err-a',
      prompt: 'See docs/specs/task-err-a.md',
      spec: null
    })
    const taskB = makeTask({
      id: 'task-err-b',
      spec: '# Inline Task B'
    })

    const { rerender } = render(<SpecDrawer {...defaultProps} task={taskA} />)
    rerender(<SpecDrawer {...defaultProps} task={taskB} />)

    await act(async () => {
      rejectFirst(new Error('File not found'))
    })

    expect(screen.getByText('# Inline Task B')).toBeInTheDocument()
  })
})
