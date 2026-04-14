import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineFilterBanner } from '../PipelineFilterBanner'
import { useSprintFilters } from '../../../stores/sprintFilters'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'bde',
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

describe('PipelineFilterBanner', () => {
  beforeEach(() => {
    useSprintFilters.setState({
      statusFilter: 'all',
      repoFilter: null,
      tagFilter: null,
      searchQuery: ''
    })
  })

  it('renders nothing when no filters are active', () => {
    const tasks = [makeTask(), makeTask()]
    const { container } = render(<PipelineFilterBanner filteredTasks={tasks} totalTasks={tasks} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when statusFilter is not "all"', () => {
    useSprintFilters.setState({ statusFilter: 'in-progress' })
    const tasks = [makeTask(), makeTask(), makeTask()]
    render(<PipelineFilterBanner filteredTasks={[tasks[0]]} totalTasks={tasks} />)
    expect(screen.getByText(/Showing 1 of 3 tasks/)).toBeInTheDocument()
    expect(screen.getByText(/status: in-progress/)).toBeInTheDocument()
  })

  it('renders when repoFilter is set', () => {
    useSprintFilters.setState({ repoFilter: 'bde' })
    const tasks = [makeTask()]
    render(<PipelineFilterBanner filteredTasks={tasks} totalTasks={tasks} />)
    expect(screen.getByText(/repo: bde/)).toBeInTheDocument()
  })

  it('renders when tagFilter is set', () => {
    useSprintFilters.setState({ tagFilter: 'urgent' })
    const tasks = [makeTask()]
    render(<PipelineFilterBanner filteredTasks={tasks} totalTasks={tasks} />)
    expect(screen.getByText(/tag: urgent/)).toBeInTheDocument()
  })

  it('renders when searchQuery is non-empty', () => {
    useSprintFilters.setState({ searchQuery: 'foo' })
    const tasks = [makeTask(), makeTask()]
    render(<PipelineFilterBanner filteredTasks={[tasks[0]]} totalTasks={tasks} />)
    expect(screen.getByText(/search:/)).toBeInTheDocument()
    expect(screen.getByText(/foo/)).toBeInTheDocument()
  })

  it('shows multiple chips when multiple filters are active', () => {
    useSprintFilters.setState({
      statusFilter: 'done',
      repoFilter: 'bde',
      tagFilter: 'urgent',
      searchQuery: 'foo'
    })
    const tasks = [makeTask()]
    render(<PipelineFilterBanner filteredTasks={tasks} totalTasks={tasks} />)
    expect(screen.getByText(/status: done/)).toBeInTheDocument()
    expect(screen.getByText(/repo: bde/)).toBeInTheDocument()
    expect(screen.getByText(/tag: urgent/)).toBeInTheDocument()
    expect(screen.getByText(/search:/)).toBeInTheDocument()
  })

  it('displays "Showing N of M tasks" count accurately', () => {
    useSprintFilters.setState({ statusFilter: 'done' })
    const all = [makeTask(), makeTask(), makeTask(), makeTask(), makeTask()]
    const filtered = [all[0], all[1]]
    render(<PipelineFilterBanner filteredTasks={filtered} totalTasks={all} />)
    expect(screen.getByText(/Showing 2 of 5 tasks/)).toBeInTheDocument()
  })

  it('clear-all button resets every filter via clearAllFilters action', () => {
    useSprintFilters.setState({
      statusFilter: 'done',
      repoFilter: 'bde',
      tagFilter: 'urgent',
      searchQuery: 'foo'
    })
    const tasks = [makeTask()]
    render(<PipelineFilterBanner filteredTasks={tasks} totalTasks={tasks} />)

    const clearBtn = screen.getByRole('button', { name: /clear all filters/i })
    fireEvent.click(clearBtn)

    const state = useSprintFilters.getState()
    expect(state.statusFilter).toBe('all')
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
  })
})
