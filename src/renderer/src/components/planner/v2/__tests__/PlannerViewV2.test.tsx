/**
 * PlannerViewV2 — smoke coverage that the v2 planner renders, lists epics,
 * and shows the empty-canvas message when no epic is selected. Stubs the
 * heavy assistant + canvas children to keep the test focused on layout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TaskGroup } from '../../../../../../shared/types'
import { nowIso } from '../../../../../../shared/time'

const taskGroupsState: {
  groups: TaskGroup[]
  selectedGroupId: string | null
  groupTasks: any[]
  loadGroups: ReturnType<typeof vi.fn>
  selectGroup: ReturnType<typeof vi.fn>
  queueAllTasks: ReturnType<typeof vi.fn>
  updateGroup: ReturnType<typeof vi.fn>
  togglePause: ReturnType<typeof vi.fn>
  loadGroupTasks: ReturnType<typeof vi.fn>
} = {
  groups: [],
  selectedGroupId: null,
  groupTasks: [],
  loadGroups: vi.fn().mockResolvedValue(undefined),
  selectGroup: vi.fn(),
  queueAllTasks: vi.fn().mockResolvedValue(0),
  updateGroup: vi.fn().mockResolvedValue(undefined),
  togglePause: vi.fn().mockResolvedValue(undefined),
  loadGroupTasks: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../../../../stores/taskGroups', () => ({
  useTaskGroups: () => taskGroupsState
}))

vi.mock('../../../../stores/taskWorkbenchModal', () => {
  const state = { openForCreate: vi.fn(), openForEdit: vi.fn() }
  const useStore = vi.fn() as any
  useStore.getState = () => state
  return { useTaskWorkbenchModalStore: useStore }
})

vi.mock('../../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

vi.mock('../../../ui/ConfirmModal', () => ({
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    confirmProps: { open: false, title: '', message: '', onConfirm: vi.fn(), onCancel: vi.fn() }
  }),
  ConfirmModal: () => null
}))

vi.mock('../../CreateEpicModal', () => ({
  CreateEpicModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-epic-modal" /> : null
}))

vi.mock('../PlPlannerHeader', () => ({
  PlPlannerHeader: ({ onNewEpic }: { onNewEpic: () => void }) => (
    <div data-testid="planner-header">
      <button onClick={onNewEpic}>+ New Epic</button>
    </div>
  )
}))

vi.mock('../PlEpicRail', () => ({
  PlEpicRail: ({ groups, onSelect }: { groups: TaskGroup[]; onSelect: (id: string) => void }) => (
    <div data-testid="epic-rail">
      {groups.map((g) => (
        <button key={g.id} data-testid={`epic-${g.id}`} onClick={() => onSelect(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../PlEpicCanvas', () => ({
  PlEpicCanvas: ({ epic }: { epic: TaskGroup }) => (
    <div data-testid="epic-canvas">Canvas: {epic.name}</div>
  )
}))

vi.mock('../PlAssistantColumn', () => ({
  PlAssistantColumn: () => <div data-testid="assistant-column" />
}))

import { PlannerViewV2 } from '../PlannerViewV2'

function makeGroup(overrides: Partial<TaskGroup> = {}): TaskGroup {
  return {
    id: crypto.randomUUID(),
    name: 'Epic A',
    icon: '🔥',
    accent_color: '#ff0000',
    goal: 'Do the thing',
    status: 'draft',
    is_paused: 0,
    depends_on: null,
    sort_order: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...overrides
  } as TaskGroup
}

describe('PlannerViewV2', () => {
  beforeEach(() => {
    taskGroupsState.groups = []
    taskGroupsState.selectedGroupId = null
    taskGroupsState.groupTasks = []
    taskGroupsState.loadGroups.mockClear()
    taskGroupsState.selectGroup.mockClear()
  })

  it('renders without crashing with an empty epic list', () => {
    const { container } = render(<PlannerViewV2 />)
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByTestId('planner-header')).toBeInTheDocument()
    expect(screen.getByTestId('epic-rail')).toBeInTheDocument()
  })

  it('shows the empty-canvas hint when no epic is selected', () => {
    render(<PlannerViewV2 />)
    expect(screen.getByText('Select an epic to get started')).toBeInTheDocument()
  })

  it('renders the epic list when epics are provided', () => {
    taskGroupsState.groups = [makeGroup({ id: 'g1', name: 'First Epic' })]
    render(<PlannerViewV2 />)
    expect(screen.getByText('First Epic')).toBeInTheDocument()
  })

  it('shows the canvas for the selected epic', () => {
    const g = makeGroup({ id: 'g1', name: 'Visible Epic' })
    taskGroupsState.groups = [g]
    taskGroupsState.selectedGroupId = 'g1'
    render(<PlannerViewV2 />)
    expect(screen.getByTestId('epic-canvas')).toBeInTheDocument()
    expect(screen.getByText('Canvas: Visible Epic')).toBeInTheDocument()
  })

  it('selects an epic via the rail click handler', () => {
    taskGroupsState.groups = [makeGroup({ id: 'g1', name: 'Pickable' })]
    render(<PlannerViewV2 />)
    fireEvent.click(screen.getByTestId('epic-g1'))
    expect(taskGroupsState.selectGroup).toHaveBeenCalledWith('g1')
  })
})
