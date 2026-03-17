import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
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
    started_at: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

import { TaskCard } from '../TaskCard'

describe('TaskCard', () => {
  const defaultProps = {
    index: 0,
    prMerged: false,
    onPushToSprint: vi.fn(),
    onLaunch: vi.fn(),
    onViewSpec: vi.fn(),
    onViewOutput: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders task title and repo badge', () => {
    const task = makeTask({ title: 'Fix the bug', repo: 'BDE' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('shows spec indicator when task has a spec', () => {
    const task = makeTask({ spec: '## Some spec' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByTitle('Has spec')).toBeInTheDocument()
  })

  it('does not show spec indicator when task has no spec', () => {
    const task = makeTask({ spec: null })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.queryByTitle('Has spec')).not.toBeInTheDocument()
  })

  it('shows PR Merged badge when prMerged is true', () => {
    const task = makeTask({ pr_url: 'https://github.com/org/repo/pull/1' })
    render(<TaskCard {...defaultProps} task={task} prMerged={true} />)

    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('shows PR Open badge when pr_url exists but not merged', () => {
    const task = makeTask({ pr_url: 'https://github.com/org/repo/pull/1' })
    render(<TaskCard {...defaultProps} task={task} prMerged={false} />)

    expect(screen.getByText('PR Open')).toBeInTheDocument()
  })

  // Status-specific action buttons

  it('backlog task shows "→ Sprint" and "Spec" buttons', () => {
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: '→ Sprint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument()
  })

  it('queued task shows "Launch" and "Spec" buttons', () => {
    const task = makeTask({ status: 'queued' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'Launch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument()
  })

  it('active task shows "View Output" button', () => {
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'View Output' })).toBeInTheDocument()
  })

  it('done task shows "View Output" button', () => {
    const task = makeTask({ status: 'done' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'View Output' })).toBeInTheDocument()
  })

  it('done task with PR shows PR number button', () => {
    const task = makeTask({ status: 'done', pr_url: 'https://github.com/pr/42', pr_number: 42 })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'PR #42' })).toBeInTheDocument()
  })

  // Callback tests

  it('clicking "→ Sprint" calls onPushToSprint', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: '→ Sprint' }))
    expect(defaultProps.onPushToSprint).toHaveBeenCalledWith(task)
  })

  it('clicking "Launch" calls onLaunch', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'queued' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Launch' }))
    expect(defaultProps.onLaunch).toHaveBeenCalledWith(task)
  })

  it('clicking "View Output" calls onViewOutput', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'View Output' }))
    expect(defaultProps.onViewOutput).toHaveBeenCalledWith(task)
  })

  it('clicking "Spec" calls onViewSpec', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Spec' }))
    expect(defaultProps.onViewSpec).toHaveBeenCalledWith(task)
  })

  // Repo badge variants

  it('renders info badge for BDE repo', () => {
    const task = makeTask({ repo: 'BDE' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--info')).toBeInTheDocument()
  })

  it('renders warning badge for feast repo', () => {
    const task = makeTask({ repo: 'feast' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--warning')).toBeInTheDocument()
  })

  it('renders success badge for life-os repo', () => {
    const task = makeTask({ repo: 'life-os' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--success')).toBeInTheDocument()
  })
})
