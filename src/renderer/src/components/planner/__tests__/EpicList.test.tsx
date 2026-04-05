import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EpicList } from '../EpicList'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'

const mockGroups: TaskGroup[] = [
  {
    id: 'group-1',
    name: 'Auth System',
    icon: 'A',
    accent_color: '#00ffcc',
    goal: 'Complete authentication',
    status: 'in-pipeline',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  },
  {
    id: 'group-2',
    name: 'Dashboard',
    icon: 'D',
    accent_color: '#ff00ff',
    goal: null,
    status: 'draft',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z'
  },
  {
    id: 'group-3',
    name: 'Completed Epic',
    icon: 'C',
    accent_color: '#00ccff',
    goal: 'Done',
    status: 'completed',
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z'
  }
]

const mockTasksDone: SprintTask[] = [
  {
    id: 'task-1',
    title: 'Task 1',
    status: 'done',
    repo: 'test',
    priority: 1,
    prompt: null,
    notes: null,
    spec: null,
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
    depends_on: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
]

const mockTasksActive: SprintTask[] = [
  {
    id: 'task-2',
    title: 'Task 2',
    status: 'active',
    repo: 'test',
    priority: 1,
    prompt: null,
    notes: null,
    spec: null,
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
    depends_on: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  },
  {
    id: 'task-3',
    title: 'Task 3',
    status: 'done',
    repo: 'test',
    priority: 1,
    prompt: null,
    notes: null,
    spec: null,
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
    depends_on: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
]

describe('EpicList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api = window.api || ({} as typeof window.api)
    window.api.groups = window.api.groups || ({} as typeof window.api.groups)
  })

  it('renders header with title and count', () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    expect(screen.getByText('Epics')).toBeInTheDocument()
    // Count shows only active groups (not completed)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders all groups', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    // Active groups are visible immediately
    await waitFor(() => {
      expect(screen.getByText('Auth System')).toBeInTheDocument()
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })

    // Completed group is in a collapsed section - expand it to see it
    const completedToggle = screen.getByText('Completed')
    fireEvent.click(completedToggle)

    await waitFor(() => {
      expect(screen.getByText('Completed Epic')).toBeInTheDocument()
    })
  })

  it('calls onSelect when group is clicked', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])
    const mockOnSelect = vi.fn()

    render(
      <EpicList
        groups={mockGroups}
        selectedId={null}
        onSelect={mockOnSelect}
        onCreateNew={vi.fn()}
      />
    )

    await waitFor(() => {
      fireEvent.click(screen.getByText('Auth System'))
    })

    expect(mockOnSelect).toHaveBeenCalledWith('group-1')
  })

  it('highlights selected group', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    const { container } = render(
      <EpicList groups={mockGroups} selectedId="group-1" onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      const selectedItem = container.querySelector('.planner-epic-item--selected')
      expect(selectedItem).toBeInTheDocument()
    })
  })

  it('shows task counts after loading', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockImplementation((groupId: string) => {
      if (groupId === 'group-1') return Promise.resolve(mockTasksActive)
      return Promise.resolve([])
    })

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      expect(screen.getByText('1/2 tasks')).toBeInTheDocument()
    })
  })

  it('handles task count loading errors gracefully', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockRejectedValue(new Error('Network error'))

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      const taskCounts = screen.getAllByText('0/0 tasks')
      // Only active groups are visible by default (completed groups are collapsed)
      const activeGroups = mockGroups.filter((g) => g.status !== 'completed')
      expect(taskCounts.length).toBe(activeGroups.length) // Should be 2
    })
  })

  it('displays correct status label for in-pipeline', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      expect(screen.getByText('In Pipeline')).toBeInTheDocument()
    })
  })

  it('displays correct status label for draft', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
  })

  it('displays correct status label for completed', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('renders New Epic button', () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    expect(screen.getByText('+ New Epic')).toBeInTheDocument()
  })

  it('calls onCreateNew when New Epic button is clicked', () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])
    const mockOnCreateNew = vi.fn()

    render(
      <EpicList
        groups={mockGroups}
        selectedId={null}
        onSelect={vi.fn()}
        onCreateNew={mockOnCreateNew}
      />
    )

    fireEvent.click(screen.getByText('+ New Epic'))
    expect(mockOnCreateNew).toHaveBeenCalledOnce()
  })

  it('renders with empty groups array', () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(<EpicList groups={[]} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />)

    expect(screen.getByText('Epics')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows progress bar with correct width', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockImplementation((groupId: string) => {
      if (groupId === 'group-1') return Promise.resolve(mockTasksActive) // 1 done, 2 total = 50%
      return Promise.resolve([])
    })

    const { container } = render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      const progressFill = container.querySelector('.planner-epic-item__progress-fill')
      expect(progressFill).toHaveStyle({ width: '50%' })
    })
  })

  it('shows 100% progress for completed tasks', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockImplementation((groupId: string) => {
      if (groupId === 'group-3') return Promise.resolve(mockTasksDone) // 1 done, 1 total = 100%
      return Promise.resolve([])
    })

    const { container } = render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    // Expand completed section to see the completed group
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
    const completedToggle = screen.getByText('Completed')
    fireEvent.click(completedToggle)

    await waitFor(() => {
      const progressFills = container.querySelectorAll('.planner-epic-item__progress-fill')
      const completedProgress = Array.from(progressFills).find(
        (el) => (el as HTMLElement).style.width === '100%'
      )
      expect(completedProgress).toBeTruthy()
    })
  })

  it('shows accent color on selected item', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    const { container } = render(
      <EpicList groups={mockGroups} selectedId="group-1" onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      const accent = container.querySelector('.planner-epic-item__accent')
      expect(accent).toHaveStyle({ background: '#00ffcc' })
    })
  })

  it('renders icon with uppercase character', async () => {
    window.api.groups.getGroupTasks = vi.fn().mockResolvedValue([])

    render(
      <EpicList groups={mockGroups} selectedId={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />
    )

    await waitFor(() => {
      const icons = screen.getAllByText('A')
      expect(icons.length).toBeGreaterThan(0)
    })
  })
})
