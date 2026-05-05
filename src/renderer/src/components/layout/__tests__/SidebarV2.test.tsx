import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false
}))

const sprintTaskState: { tasks: Array<{ id: string; title: string; status: string }> } = {
  tasks: []
}

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector?: any) =>
    typeof selector === 'function' ? selector(sprintTaskState) : sprintTaskState
  ),
  selectReviewTaskCount: (s: typeof sprintTaskState) =>
    s.tasks.reduce((n, t) => (t.status === 'review' ? n + 1 : n), 0),
  selectFailedTaskCount: (s: typeof sprintTaskState) =>
    s.tasks.reduce((n, t) => (t.status === 'failed' || t.status === 'error' ? n + 1 : n), 0)
}))

const mockSetView = vi.fn()
const mockSetSelectedTaskId = vi.fn()

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((selector: any) =>
    selector({ activeView: 'dashboard', setView: mockSetView })
  )
}))

vi.mock('../../../stores/sprintSelection', () => ({
  useSprintSelection: vi.fn((selector: any) =>
    selector({ setSelectedTaskId: mockSetSelectedTaskId })
  )
}))

vi.mock('../../../stores/gitTree', () => ({
  useGitTreeStore: vi.fn((selector: any) => selector({ branch: 'main' }))
}))

// Force the dispatcher to render V2.
vi.mock('../../../stores/featureFlags', () => ({
  useFeatureFlags: vi.fn((selector: any) =>
    selector({
      v2Shell: true,
      v2Dashboard: false,
      v2Pipeline: false,
      v2Agents: true,
      v2Planner: false
    })
  )
}))

import { Sidebar } from '../Sidebar'
import { SidebarV2 } from '../SidebarV2'

describe('SidebarV2 (rendered via Sidebar dispatcher)', () => {
  beforeEach(() => {
    sprintTaskState.tasks = []
    mockSetView.mockClear()
    mockSetSelectedTaskId.mockClear()
  })

  it('renders the V2 sidebar (with workspace eyebrow) when v2Shell is true', () => {
    const { container } = render(<Sidebar />)
    expect(container.querySelector('.sidebar-v2')).not.toBeNull()
  })

  it('does not show the live agents block when there are no active tasks', () => {
    render(<SidebarV2 />)
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('renders one LiveAgentRow when there is a single active task', () => {
    sprintTaskState.tasks = [{ id: 't1', title: 'Refactor login', status: 'active' }]
    render(<SidebarV2 />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Refactor login')).toBeInTheDocument()
  })

  it('caps the live agents block at three rows when there are more active tasks', () => {
    sprintTaskState.tasks = [
      { id: 't1', title: 'Task one', status: 'active' },
      { id: 't2', title: 'Task two', status: 'active' },
      { id: 't3', title: 'Task three', status: 'active' },
      { id: 't4', title: 'Task four', status: 'active' }
    ]
    render(<SidebarV2 />)
    // The live count display still shows the full count
    expect(screen.getByText('4')).toBeInTheDocument()
    // Only the first three rows are rendered
    expect(screen.getByText('Task one')).toBeInTheDocument()
    expect(screen.getByText('Task two')).toBeInTheDocument()
    expect(screen.getByText('Task three')).toBeInTheDocument()
    expect(screen.queryByText('Task four')).toBeNull()
  })
})
