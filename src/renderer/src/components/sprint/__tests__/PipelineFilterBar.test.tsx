import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineFilterBar } from '../PipelineFilterBar'
import { useSprintFilters } from '../../../stores/sprintFilters'
import { useFilterPresets } from '../../../stores/filterPresets'
import type { SprintTask } from '../../../../../shared/types'
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

describe('PipelineFilterBar - Presets', () => {
  beforeEach(() => {
    useSprintFilters.setState({
      repoFilter: null,
      searchQuery: '',
      statusFilter: 'all'
    })
    useFilterPresets.setState({ presets: {} })
  })

  it('renders "Save View" button when filters are active', () => {
    useSprintFilters.setState({ searchQuery: 'test' })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    expect(screen.getByText('Save View')).toBeInTheDocument()
  })

  it('does not render "Save View" when no filters active', () => {
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    expect(screen.queryByText('Save View')).not.toBeInTheDocument()
  })

  it('renders preset chips for saved presets', () => {
    useFilterPresets.setState({
      presets: {
        'My View': { repoFilter: 'BDE', searchQuery: 'bug', statusFilter: 'blocked' },
        Debug: { repoFilter: null, searchQuery: 'error', statusFilter: 'failed' }
      }
    })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    expect(screen.getByText('My View')).toBeInTheDocument()
    expect(screen.getByText('Debug')).toBeInTheDocument()
  })

  it('applies filters when preset is clicked', () => {
    useFilterPresets.setState({
      presets: {
        'Test Preset': { repoFilter: 'BDE', searchQuery: 'feature', statusFilter: 'done' }
      }
    })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    const presetChip = screen.getByText('Test Preset')
    fireEvent.click(presetChip)

    const state = useSprintFilters.getState()
    expect(state.repoFilter).toBe('BDE')
    expect(state.searchQuery).toBe('feature')
    expect(state.statusFilter).toBe('done')
  })

  it('clicking "Save View" button opens prompt modal', () => {
    useSprintFilters.setState({ searchQuery: 'test' })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    const saveButton = screen.getByText('Save View')
    fireEvent.click(saveButton)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Save Filter Preset')).toBeInTheDocument()
  })

  it('saves current filters as preset when name provided via modal', () => {
    useSprintFilters.setState({
      repoFilter: 'BDE',
      searchQuery: 'bug',
      statusFilter: 'blocked'
    })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    const saveButton = screen.getByText('Save View')
    fireEvent.click(saveButton)

    // Type name in prompt modal and confirm
    const input = screen.getByLabelText('Enter a name for this filter preset:')
    fireEvent.change(input, { target: { value: 'My Preset' } })
    fireEvent.click(screen.getByText('Save'))

    const { presets } = useFilterPresets.getState()
    expect(presets['My Preset']).toEqual({
      repoFilter: 'BDE',
      searchQuery: 'bug',
      statusFilter: 'blocked'
    })
  })

  it('does not save preset when prompt modal is cancelled', () => {
    useSprintFilters.setState({ searchQuery: 'test' })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    const saveButton = screen.getByText('Save View')
    fireEvent.click(saveButton)
    fireEvent.click(screen.getByText('Cancel'))

    const { presets } = useFilterPresets.getState()
    expect(Object.keys(presets).length).toBe(0)
  })

  it('deletes preset when X button is clicked', () => {
    useFilterPresets.setState({
      presets: {
        'Remove Me': { repoFilter: null, searchQuery: 'test', statusFilter: 'all' }
      }
    })
    const tasks = [makeTask({ repo: 'BDE' })]

    render(<PipelineFilterBar tasks={tasks} />)

    const deleteButton = screen.getByLabelText('Delete preset "Remove Me"')
    fireEvent.click(deleteButton)

    const { presets } = useFilterPresets.getState()
    expect(presets['Remove Me']).toBeUndefined()
  })
})
