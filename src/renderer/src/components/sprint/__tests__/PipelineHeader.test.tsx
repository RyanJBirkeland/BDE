import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PipelineHeader } from '../PipelineHeader'
import { useSprintUI } from '../../../stores/sprintUI'
import type { SprintTask, AgentManagerStatus } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

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
    updated_at: nowIso(),
    created_at: nowIso(),
    ...overrides
  }
}

describe('PipelineHeader', () => {
  const defaultStats = [
    { label: 'active', count: 2, filter: 'in-progress' as const },
    { label: 'queued', count: 1, filter: 'todo' as const },
    { label: 'blocked', count: 0, filter: 'blocked' as const },
    { label: 'review', count: 0, filter: 'awaiting-review' as const },
    { label: 'failed', count: 0, filter: 'failed' as const },
    { label: 'done', count: 3, filter: 'done' as const }
  ]

  beforeEach(() => {
    // Reset store to default state
    useSprintUI.getState().setPipelineDensity('card')
    // Setup default window.api mock
    global.window.api = {
      agentManager: {
        status: vi.fn()
      }
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders title "Task Pipeline"', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.getByText('Task Pipeline')).toBeInTheDocument()
  })

  it('renders all stat badges with correct counts', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('done')).toBeInTheDocument()
  })

  it('calls onFilterClick when stat badge is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    const activeElement = screen.getByText('active').closest('button') as HTMLElement
    fireEvent.click(activeElement)
    expect(mockFilterClick).toHaveBeenCalledWith('in-progress')
  })

  it('calls onFilterClick on Enter key press', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    const queuedElement = screen.getByText('queued').closest('button') as HTMLElement
    fireEvent.click(queuedElement)
    expect(mockFilterClick).toHaveBeenCalledWith('todo')
  })

  it('calls onFilterClick on Space key press', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    const blockedElement = screen.getByText('blocked').closest('button') as HTMLElement
    fireEvent.click(blockedElement)
    expect(mockFilterClick).toHaveBeenCalledWith('blocked')
  })

  it('does not render conflict badge when no conflicting tasks', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.queryByLabelText(/merge conflict/)).not.toBeInTheDocument()
  })

  it('renders conflict badge when conflicting tasks exist', () => {
    const conflictingTasks = [makeTask({ id: 'c1' }), makeTask({ id: 'c2' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.getByLabelText('2 merge conflicts')).toBeInTheDocument()
  })

  it('calls onConflictClick when conflict badge is clicked', () => {
    const mockConflictClick = vi.fn()
    const conflictingTasks = [makeTask({ id: 'c1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={mockConflictClick}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    fireEvent.click(screen.getByLabelText('1 merge conflict'))
    expect(mockConflictClick).toHaveBeenCalledOnce()
  })

  it('does not render health check badge when no stuck tasks', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.queryByLabelText(/stuck task/)).not.toBeInTheDocument()
  })

  it('renders health check badge when stuck tasks exist', () => {
    const stuckTasks = [makeTask({ id: 's1' }), makeTask({ id: 's2' }), makeTask({ id: 's3' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.getByLabelText('3 stuck tasks')).toBeInTheDocument()
  })

  it('calls onHealthCheckClick when health check badge is clicked', () => {
    const mockHealthCheckClick = vi.fn()
    const stuckTasks = [makeTask({ id: 's1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={mockHealthCheckClick}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    fireEvent.click(screen.getByLabelText('1 stuck task'))
    expect(mockHealthCheckClick).toHaveBeenCalledOnce()
  })

  it('renders both conflict and health check badges when both exist', () => {
    const conflictingTasks = [makeTask({ id: 'c1' })]
    const stuckTasks = [makeTask({ id: 's1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
        onDagToggle={vi.fn()}
        dagOpen={false}
      />
    )
    expect(screen.getByLabelText('1 merge conflict')).toBeInTheDocument()
    expect(screen.getByLabelText('1 stuck task')).toBeInTheDocument()
  })

  it('renders density toggle button', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Switch to compact view')).toBeInTheDocument()
  })

  it('toggles density from card to compact when clicked', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const toggleButton = screen.getByLabelText('Switch to compact view')
    expect(useSprintUI.getState().pipelineDensity).toBe('card')

    fireEvent.click(toggleButton)
    expect(useSprintUI.getState().pipelineDensity).toBe('compact')
  })

  it('toggles density from compact to card when clicked', () => {
    useSprintUI.getState().setPipelineDensity('compact')
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const toggleButton = screen.getByLabelText('Switch to card view')
    expect(useSprintUI.getState().pipelineDensity).toBe('compact')

    fireEvent.click(toggleButton)
    expect(useSprintUI.getState().pipelineDensity).toBe('card')
  })

  it('shows correct icon and label for card density', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const toggleButton = screen.getByLabelText('Switch to compact view')
    expect(toggleButton).toHaveAttribute('title', 'Switch to compact view')
  })

  it('shows correct icon and label for compact density', () => {
    useSprintUI.getState().setPipelineDensity('compact')
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const toggleButton = screen.getByLabelText('Switch to card view')
    expect(toggleButton).toHaveAttribute('title', 'Switch to card view')
  })

  describe('WIP slot badge', () => {
    it('renders WIP badge when agent manager status is available', async () => {
      const mockStatus: AgentManagerStatus = {
        running: true,
        shuttingDown: false,
        concurrency: {
          maxSlots: 2,
          activeCount: 1,
          capacityAfterBackpressure: 2,
          recoveryScheduledAt: null,
          consecutiveRateLimits: 0,
          atMinimumCapacity: false
        },
        activeAgents: []
      }

      vi.mocked(window.api.agentManager.status).mockResolvedValue(mockStatus)

      render(
        <PipelineHeader
          stats={defaultStats}
          conflictingTasks={[]}
          visibleStuckTasks={[]}
          onFilterClick={vi.fn()}
          onConflictClick={vi.fn()}
          onHealthCheckClick={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('slots')).toBeInTheDocument()
        const badge = screen.getByTitle('Max concurrent agents. Change in Settings → Agents.')
        expect(badge.textContent).toContain('1')
        expect(badge.textContent).toContain('2')
      })
    })

    it('does not render WIP badge when agent manager throws error', async () => {
      vi.mocked(window.api.agentManager.status).mockRejectedValue(
        new Error('Agent manager not available')
      )

      render(
        <PipelineHeader
          stats={defaultStats}
          conflictingTasks={[]}
          visibleStuckTasks={[]}
          onFilterClick={vi.fn()}
          onConflictClick={vi.fn()}
          onHealthCheckClick={vi.fn()}
        />
      )

      // Wait a bit to ensure the effect has run and failed
      await waitFor(() => {
        // Badge should not render when slots are null
        expect(screen.queryByText('slots')).not.toBeInTheDocument()
      })
    })

    it('displays active and max slots correctly', async () => {
      const mockStatus: AgentManagerStatus = {
        running: true,
        shuttingDown: false,
        concurrency: {
          maxSlots: 3,
          activeCount: 2,
          capacityAfterBackpressure: 3,
          recoveryScheduledAt: null,
          consecutiveRateLimits: 0,
          atMinimumCapacity: false
        },
        activeAgents: []
      }

      vi.mocked(window.api.agentManager.status).mockResolvedValue(mockStatus)

      render(
        <PipelineHeader
          stats={defaultStats}
          conflictingTasks={[]}
          visibleStuckTasks={[]}
          onFilterClick={vi.fn()}
          onConflictClick={vi.fn()}
          onHealthCheckClick={vi.fn()}
        />
      )

      await waitFor(() => {
        const badge = screen.getByTitle('Max concurrent agents. Change in Settings → Agents.')
        expect(badge).toBeInTheDocument()
        expect(badge.textContent).toContain('2')
        expect(badge.textContent).toContain('3')
        expect(badge.textContent).toContain('slots')
      })
    })
  })
})
