import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('../TaskWorkbench', () => ({
  TaskWorkbench: ({ onSubmitted }: { onSubmitted?: () => void }) => (
    <div data-testid="task-workbench-stub">
      <button data-testid="submit" onClick={() => onSubmitted?.()}>
        submit
      </button>
    </div>
  )
}))

const formMocks = vi.hoisted(() => ({
  isDirty: vi.fn(() => false),
  resetForm: vi.fn(),
  loadTask: vi.fn(),
  setField: vi.fn()
}))

vi.mock('../../../stores/taskWorkbench', () => {
  const state = {
    isDirty: formMocks.isDirty,
    resetForm: formMocks.resetForm,
    loadTask: formMocks.loadTask,
    setField: formMocks.setField
  }
  return {
    useTaskWorkbenchStore: Object.assign(
      vi.fn((selector?: (s: typeof state) => unknown) =>
        typeof selector === 'function' ? selector(state) : state
      ),
      { getState: () => state }
    )
  }
})

vi.mock('../../../stores/copilot', () => {
  const state = { visible: false, toggleVisible: vi.fn() }
  return {
    useCopilotStore: Object.assign(
      vi.fn((selector?: (s: typeof state) => unknown) =>
        typeof selector === 'function' ? selector(state) : state
      ),
      { getState: () => state }
    )
  }
})

import { TaskWorkbenchModal } from '../TaskWorkbenchModal'
import { useTaskWorkbenchModalStore } from '../../../stores/taskWorkbenchModal'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Sample task',
    repo: 'bde',
    status: 'queued',
    pr_url: null,
    pr_number: null,
    pr_status: null,
    completed_at: null,
    description: null,
    spec: null,
    branch: null,
    notes: null,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    started_at: null,
    depends_on: [],
    claimed_by: null,
    agent_run_id: null,
    priority: 3,
    fast_fail_count: 0,
    max_runtime_ms: null,
    ...overrides
  } as SprintTask
}

describe('TaskWorkbenchModal', () => {
  beforeEach(() => {
    formMocks.isDirty.mockReset().mockReturnValue(false)
    formMocks.resetForm.mockReset()
    formMocks.loadTask.mockReset()
    useTaskWorkbenchModalStore.setState({ open: false, editingTask: null })
  })

  it('renders nothing when closed', () => {
    render(<TaskWorkbenchModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders "New Task" title in create mode', () => {
    useTaskWorkbenchModalStore.setState({ open: true, editingTask: null })
    render(<TaskWorkbenchModal />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('New Task')
  })

  it('renders Edit: <title> in edit mode', () => {
    useTaskWorkbenchModalStore.setState({
      open: true,
      editingTask: makeTask({ title: 'Refactor reviewer prompt' })
    })
    render(<TaskWorkbenchModal />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit: Refactor reviewer prompt')
  })

  it('truncates long edit titles', () => {
    const longTitle = 'a'.repeat(120)
    useTaskWorkbenchModalStore.setState({
      open: true,
      editingTask: makeTask({ title: longTitle })
    })
    render(<TaskWorkbenchModal />)
    const name = screen.getByRole('dialog').getAttribute('aria-labelledby')
    expect(name).toBeTruthy()
    expect(screen.getByRole('heading').textContent).toMatch(/…$/)
  })

  it('closes immediately on X click when form is clean', () => {
    useTaskWorkbenchModalStore.setState({ open: true, editingTask: null })
    render(<TaskWorkbenchModal />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(useTaskWorkbenchModalStore.getState().open).toBe(false)
  })

  it('prompts before closing when form is dirty', async () => {
    formMocks.isDirty.mockReturnValue(true)
    useTaskWorkbenchModalStore.setState({ open: true, editingTask: null })
    render(<TaskWorkbenchModal />)
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(screen.getByText(/Discard changes/i)).toBeTruthy())
    expect(useTaskWorkbenchModalStore.getState().open).toBe(true)
  })

  it('closes when onSubmitted fires from inner workbench', () => {
    useTaskWorkbenchModalStore.setState({ open: true, editingTask: null })
    render(<TaskWorkbenchModal />)
    fireEvent.click(screen.getByTestId('submit'))
    expect(useTaskWorkbenchModalStore.getState().open).toBe(false)
  })
})
