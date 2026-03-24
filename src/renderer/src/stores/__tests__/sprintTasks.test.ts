import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SprintTask } from '../../../../shared/types'

// Mock the toasts module before importing the store
vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    undoable: vi.fn(),
  },
}))

import { useSprintTasks } from '../sprintTasks'
import { toast } from '../toasts'

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'backlog',
  notes: null,
  spec: null,
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
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
})

const initialState = {
  tasks: [] as SprintTask[],
  loading: true,
  loadError: null,
  prMergedMap: {},
  pendingUpdates: new Map<string, number>(),
  pendingCreates: new Set<string>(),
}

describe('sprintTasks store', () => {
  beforeEach(() => {
    useSprintTasks.setState(initialState)
    vi.clearAllMocks()
    // Reset mocks on window.api.sprint
    const sprint = window.api.sprint as unknown as Record<string, ReturnType<typeof vi.fn>>
    sprint.list.mockResolvedValue([])
    sprint.update.mockResolvedValue({})
    sprint.delete.mockResolvedValue({ ok: true })
  })

  describe('loadData', () => {
    it('populates tasks on success', async () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue(tasks)

      await useSprintTasks.getState().loadData()

      const state = useSprintTasks.getState()
      expect(state.tasks).toHaveLength(2)
      expect(state.tasks[0].id).toBe('t1')
      expect(state.tasks[1].id).toBe('t2')
      expect(state.loading).toBe(false)
      expect(state.loadError).toBeNull()
    })

    it('sets loadError on failure', async () => {
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network error')
      )

      await useSprintTasks.getState().loadData()

      const state = useSprintTasks.getState()
      expect(state.loadError).toMatch(/network error/)
      expect(state.loading).toBe(false)
    })

    it('handles non-array result gracefully', async () => {
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      await useSprintTasks.getState().loadData()

      expect(useSprintTasks.getState().tasks).toEqual([])
    })
  })

  describe('updateTask', () => {
    it('applies optimistic update immediately', async () => {
      const task = makeTask('t1', { status: 'backlog' })
      useSprintTasks.setState({ tasks: [task], pendingUpdates: new Map(), pendingCreates: new Set() })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

      const updatePromise = useSprintTasks.getState().updateTask('t1', { status: 'active' })

      // Optimistic update happens synchronously before await
      expect(useSprintTasks.getState().tasks[0].status).toBe('active')

      await updatePromise
    })

    it('removes task from pendingUpdates after successful update', async () => {
      const task = makeTask('t1')
      useSprintTasks.setState({ tasks: [task], pendingUpdates: new Map(), pendingCreates: new Set() })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

      await useSprintTasks.getState().updateTask('t1', { status: 'active' })

      expect(useSprintTasks.getState().pendingUpdates.has('t1')).toBe(false)
    })

    it('calls toast.error and reloads on failure', async () => {
      const task = makeTask('t1')
      useSprintTasks.setState({ tasks: [task], pendingUpdates: new Map(), pendingCreates: new Set() })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('update failed')
      )
      // loadData will be called by updateTask on failure — prevent it from breaking
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([task])

      await useSprintTasks.getState().updateTask('t1', { status: 'active' })

      expect(toast.error).toHaveBeenCalledWith('update failed')
    })
  })

  describe('mergeSseUpdate', () => {
    it('merges fields from SSE event into the matching task', () => {
      const task = makeTask('t1', { status: 'active' })
      useSprintTasks.setState({ tasks: [task] })

      useSprintTasks.getState().mergeSseUpdate({ taskId: 't1', status: 'done', pr_url: 'https://github.com/pr/1' })

      const updated = useSprintTasks.getState().tasks[0]
      expect(updated.status).toBe('done')
      expect(updated.pr_url).toBe('https://github.com/pr/1')
    })

    it('auto-sets pr_status to open when task is done with pr_url and no pr_status', () => {
      const task = makeTask('t1', { status: 'active', pr_url: null, pr_status: null })
      useSprintTasks.setState({ tasks: [task] })

      useSprintTasks.getState().mergeSseUpdate({
        taskId: 't1',
        status: 'done',
        pr_url: 'https://github.com/pr/1',
      })

      expect(useSprintTasks.getState().tasks[0].pr_status).toBe('open')
    })

    it('does not affect other tasks', () => {
      const t1 = makeTask('t1', { status: 'active' })
      const t2 = makeTask('t2', { status: 'backlog' })
      useSprintTasks.setState({ tasks: [t1, t2] })

      useSprintTasks.getState().mergeSseUpdate({ taskId: 't1', status: 'done' })

      expect(useSprintTasks.getState().tasks[1].status).toBe('backlog')
    })
  })

  describe('deleteTask', () => {
    it('removes the task from the list on success', async () => {
      const t1 = makeTask('t1')
      const t2 = makeTask('t2')
      useSprintTasks.setState({ tasks: [t1, t2] })
      ;(window.api.sprint.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

      await useSprintTasks.getState().deleteTask('t1')

      const tasks = useSprintTasks.getState().tasks
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('t2')
    })

    it('calls toast.success after deletion', async () => {
      useSprintTasks.setState({ tasks: [makeTask('t1')] })
      ;(window.api.sprint.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

      await useSprintTasks.getState().deleteTask('t1')

      expect(toast.success).toHaveBeenCalledWith('Task deleted')
    })

    it('calls toast.error when deletion fails', async () => {
      useSprintTasks.setState({ tasks: [makeTask('t1')] })
      ;(window.api.sprint.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('delete failed')
      )

      await useSprintTasks.getState().deleteTask('t1')

      expect(toast.error).toHaveBeenCalledWith('delete failed')
    })
  })
})
