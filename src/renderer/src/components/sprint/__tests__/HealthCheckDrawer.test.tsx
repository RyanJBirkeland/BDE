import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HealthCheckDrawer } from '../HealthCheckDrawer'
import type { SprintTask } from '../../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    repo: 'my-repo',
    status: 'active',
    started_at: new Date(Date.now() - 120_000).toISOString(), // 2 minutes ago
    completed_at: null,
    description: null,
    spec: null,
    pr_url: null,
    pr_status: null,
    pr_number: null,
    branch: null,
    notes: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-20T12:00:00Z',
    depends_on: [],
    claimed_by: null,
    agent_run_id: 'agent-123',
    priority: 0,
    fast_fail_count: 0,
    max_runtime_ms: null,
    ...overrides
  } as SprintTask
}

function makeProps(overrides: Partial<Parameters<typeof HealthCheckDrawer>[0]> = {}) {
  return {
    open: true,
    tasks: [makeTask({ id: 'task-1', title: 'Stuck Task' })],
    onClose: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides
  }
}

describe('HealthCheckDrawer', () => {
  it('renders title with task count when open', () => {
    render(<HealthCheckDrawer {...makeProps()} />)
    expect(screen.getByText('Stuck Tasks')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders all stuck task titles', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Alpha Stuck' }),
      makeTask({ id: '2', title: 'Beta Stuck' })
    ]
    render(<HealthCheckDrawer {...makeProps({ tasks })} />)
    expect(screen.getByText('Alpha Stuck')).toBeInTheDocument()
    expect(screen.getByText('Beta Stuck')).toBeInTheDocument()
  })

  it('calls onClose when overlay clicked', () => {
    const props = makeProps()
    render(<HealthCheckDrawer {...props} />)
    const overlay = document.querySelector('.health-drawer__overlay')
    expect(overlay).toBeTruthy()
    fireEvent.click(overlay!)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button clicked', () => {
    const props = makeProps()
    render(<HealthCheckDrawer {...props} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onDismiss when Dismiss button clicked', () => {
    const props = makeProps()
    render(<HealthCheckDrawer {...props} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(props.onDismiss).toHaveBeenCalledWith('task-1')
  })

  it('shows empty state when no tasks', () => {
    render(<HealthCheckDrawer {...makeProps({ tasks: [] })} />)
    expect(screen.getByText('No stuck tasks detected.')).toBeInTheDocument()
  })

  it('does not render overlay when closed', () => {
    render(<HealthCheckDrawer {...makeProps({ open: false })} />)
    const overlay = document.querySelector('.health-drawer__overlay')
    expect(overlay).not.toBeInTheDocument()
  })

  it('renders a resize handle', () => {
    const { container } = render(<HealthCheckDrawer {...makeProps()} />)
    expect(container.querySelector('.drawer-resize-handle')).not.toBeNull()
  })
})
