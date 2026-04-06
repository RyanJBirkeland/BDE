import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadGroups = vi.fn().mockResolvedValue(undefined)
const mockSelectGroup = vi.fn()
const mockQueueAllTasks = vi.fn().mockResolvedValue(0)
const mockUpdateGroup = vi.fn().mockResolvedValue(undefined)
const mockDeleteGroup = vi.fn().mockResolvedValue(undefined)
const mockReorderTasks = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/taskGroups', () => ({
  useTaskGroups: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      groups: [
        {
          id: 'g1',
          name: 'Sprint 1',
          icon: '🚀',
          accent_color: '#00ff00',
          goal: 'Ship features',
          status: 'draft',
          created_at: '2026-01-01',
          updated_at: '2026-01-01'
        }
      ],
      selectedGroupId: 'g1',
      groupTasks: [
        {
          id: 't1',
          title: 'Task A',
          repo: 'bde',
          status: 'backlog',
          spec: '## Spec\nDo stuff',
          prompt: null,
          priority: 1,
          notes: null,
          retry_count: 0,
          fast_fail_count: 0,
          agent_run_id: null,
          pr_number: null,
          pr_status: null,
          pr_mergeable_state: null,
          pr_url: null,
          claimed_by: null,
          started_at: null,
          completed_at: null,
          template_name: null,
          depends_on: null,
          updated_at: '2026-01-01',
          created_at: '2026-01-01'
        }
      ],
      loading: false,
      loadGroups: mockLoadGroups,
      selectGroup: mockSelectGroup,
      queueAllTasks: mockQueueAllTasks,
      updateGroup: mockUpdateGroup,
      deleteGroup: mockDeleteGroup,
      reorderTasks: mockReorderTasks
    }
    return selector ? selector(state) : state
  })
}))

vi.mock('../../stores/taskWorkbench', () => ({
  useTaskWorkbenchStore: {
    getState: vi.fn().mockReturnValue({
      resetForm: vi.fn(),
      setField: vi.fn()
    })
  }
}))

vi.mock('../../stores/panelLayout', () => ({
  usePanelLayoutStore: {
    getState: vi.fn().mockReturnValue({
      setView: vi.fn()
    })
  }
}))

vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('../../components/planner/EpicList', () => ({
  EpicList: ({ onCreateNew }: { onCreateNew: () => void }) => (
    <div data-testid="epic-list">
      <button onClick={onCreateNew}>Create New</button>
    </div>
  )
}))

vi.mock('../../components/planner/EpicDetail', () => ({
  EpicDetail: ({
    onQueueAll,
    onAddTask,
    onEditTask,
    onEditGroup,
    onDeleteGroup,
    onToggleReady,
    onReorderTasks
  }: {
    onQueueAll: () => void
    onAddTask: () => void
    onEditTask: (id: string) => void
    onEditGroup: (name: string, goal: string) => void
    onDeleteGroup: () => void
    onToggleReady: () => void
    onReorderTasks: (ids: string[]) => void
  }) => (
    <div data-testid="epic-detail">
      <button onClick={onQueueAll}>Queue All</button>
      <button onClick={onAddTask}>Add Task</button>
      <button onClick={() => onEditTask('t1')}>Edit Task</button>
      <button onClick={() => onEditGroup('Updated', 'New goal')}>Edit Group</button>
      <button onClick={onDeleteGroup}>Delete Group</button>
      <button onClick={onToggleReady}>Toggle Ready</button>
      <button onClick={() => onReorderTasks(['t1'])}>Reorder</button>
    </div>
  )
}))

vi.mock('../../components/planner/CreateEpicModal', () => ({
  CreateEpicModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-modal">Create Modal</div> : null
}))

vi.mock('../../components/ui/ConfirmModal', () => ({
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    confirmProps: {}
  }),
  ConfirmModal: () => null
}))

vi.mock('../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false
}))

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import PlannerView from '../PlannerView'

describe('PlannerView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the planner header with title', () => {
    render(<PlannerView />)
    expect(screen.getByText('Task Planner')).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(<PlannerView />)
    expect(screen.getByPlaceholderText('Search epics...')).toBeInTheDocument()
  })

  it('renders import button', () => {
    render(<PlannerView />)
    expect(screen.getByText('Import doc')).toBeInTheDocument()
  })

  it('renders EpicList', () => {
    render(<PlannerView />)
    expect(screen.getByTestId('epic-list')).toBeInTheDocument()
  })

  it('renders EpicDetail when a group is selected', () => {
    render(<PlannerView />)
    expect(screen.getByTestId('epic-detail')).toBeInTheDocument()
  })

  it('calls loadGroups on mount', () => {
    render(<PlannerView />)
    expect(mockLoadGroups).toHaveBeenCalled()
  })

  it('search input updates search query', () => {
    render(<PlannerView />)
    const input = screen.getByPlaceholderText('Search epics...')
    fireEvent.change(input, { target: { value: 'test' } })
    expect(input).toHaveValue('test')
  })

  it('opens create modal when Create New is clicked', () => {
    render(<PlannerView />)
    expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Create New'))
    expect(screen.getByTestId('create-modal')).toBeInTheDocument()
  })

  it('handles Add Task action without error', () => {
    render(<PlannerView />)
    // Just verify clicking Add Task does not throw
    fireEvent.click(screen.getByText('Add Task'))
  })

  it('handles Edit Group action', async () => {
    render(<PlannerView />)
    fireEvent.click(screen.getByText('Edit Group'))
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { name: 'Updated', goal: 'New goal' })
  })

  it('handles Delete Group action', async () => {
    render(<PlannerView />)
    fireEvent.click(screen.getByText('Delete Group'))
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1')
  })

  it('handles Reorder action', () => {
    render(<PlannerView />)
    fireEvent.click(screen.getByText('Reorder'))
    expect(mockReorderTasks).toHaveBeenCalledWith('g1', ['t1'])
  })

  it('handles import plan click', async () => {
    ;(window.api as Record<string, unknown>).planner = {
      import: vi.fn().mockResolvedValue({
        epicName: 'Imported Epic',
        taskCount: 3,
        epicId: 'ep-1'
      })
    }
    render(<PlannerView />)
    fireEvent.click(screen.getByText('Import doc'))
  })
})
