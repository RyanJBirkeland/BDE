import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SprintTask } from '../../../../shared/types'

// Mock the toasts module before importing the store
vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    undoable: vi.fn()
  }
}))

vi.mock('../../../../shared/template-heuristics', () => ({
  detectTemplate: vi.fn().mockReturnValue(null)
}))

import { useSprintTasks } from '../sprintTasks'
import { useSprintUI } from '../sprintUI'
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
  ...overrides
})

const initialState = {
  tasks: [] as SprintTask[],
  loading: true,
  loadError: null,
  prMergedMap: {},
  pendingUpdates: {} as Record<string, { ts: number; fields: string[] }>,
  pendingCreates: [] as string[]
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
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

      const updatePromise = useSprintTasks.getState().updateTask('t1', { status: 'active' })

      // Optimistic update happens synchronously before await
      expect(useSprintTasks.getState().tasks[0].status).toBe('active')

      await updatePromise
    })

    it('removes task from pendingUpdates after successful update', async () => {
      const task = makeTask('t1')
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

      await useSprintTasks.getState().updateTask('t1', { status: 'active' })

      expect('t1' in useSprintTasks.getState().pendingUpdates).toBe(false)
    })

    it('calls toast.error and reloads on failure', async () => {
      const task = makeTask('t1')
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
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

      useSprintTasks
        .getState()
        .mergeSseUpdate({ taskId: 't1', status: 'done', pr_url: 'https://github.com/pr/1' })

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
        pr_url: 'https://github.com/pr/1'
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

    it('calls clearTaskIfSelected on sprintUI store after delete', async () => {
      useSprintTasks.setState({ tasks: [makeTask('t1')] })
      useSprintUI.setState({ selectedTaskId: 't1', drawerOpen: true })
      ;(window.api.sprint.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

      await useSprintTasks.getState().deleteTask('t1')

      expect(useSprintUI.getState().selectedTaskId).toBeNull()
      expect(useSprintUI.getState().drawerOpen).toBe(false)
    })
  })

  describe('createTask', () => {
    beforeEach(() => {
      ;(window.api.sprint.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTask('server-id-1')
      )
      ;(window.api.sprint.generatePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        taskId: 'server-id-1',
        spec: 'generated spec',
        prompt: 'generated prompt'
      })
    })

    it('optimistically adds task before IPC call resolves', async () => {
      let resolveCreate!: (v: SprintTask) => void
      ;(window.api.sprint.create as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise<SprintTask>((res) => {
          resolveCreate = res
        })
      )

      const createPromise = useSprintTasks.getState().createTask({
        title: 'New task',
        repo: 'BDE',
        priority: 1
      })

      // Before IPC resolves, task should already be in list
      expect(useSprintTasks.getState().tasks).toHaveLength(1)
      expect(useSprintTasks.getState().tasks[0].title).toBe('New task')
      expect(useSprintTasks.getState().tasks[0].id).toMatch(/^temp-/)

      resolveCreate(makeTask('server-id-1'))
      await createPromise
    })

    it('replaces temp task with server task on success', async () => {
      await useSprintTasks.getState().createTask({
        title: 'My task',
        repo: 'BDE',
        priority: 2
      })

      const tasks = useSprintTasks.getState().tasks
      // temp task should be replaced
      expect(tasks.every((t) => !t.id.startsWith('temp-'))).toBe(true)
      expect(tasks.some((t) => t.id === 'server-id-1')).toBe(true)
    })

    it('calls toast.success after successful create', async () => {
      await useSprintTasks.getState().createTask({
        title: 'My task',
        repo: 'BDE',
        priority: 1
      })

      expect(toast.success).toHaveBeenCalledWith('Ticket created — saved to Backlog')
    })

    it('normalises repo to lowercase', async () => {
      await useSprintTasks.getState().createTask({
        title: 'Repo case test',
        repo: 'BDE',
        priority: 1
      })

      // The IPC was called with the lowercased repo
      expect(window.api.sprint.create).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'bde' })
      )
    })

    it('rolls back optimistic task and shows error on IPC failure', async () => {
      ;(window.api.sprint.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('create failed')
      )

      await useSprintTasks.getState().createTask({
        title: 'Failed task',
        repo: 'BDE',
        priority: 1
      })

      expect(useSprintTasks.getState().tasks).toHaveLength(0)
      expect(useSprintTasks.getState().pendingCreates.length).toBe(0)
      expect(toast.error).toHaveBeenCalledWith('create failed')
    })

    it('skips spec generation when spec is already provided', async () => {
      await useSprintTasks.getState().createTask({
        title: 'Task with spec',
        repo: 'BDE',
        priority: 1,
        spec: 'existing spec'
      })

      expect(window.api.sprint.generatePrompt).not.toHaveBeenCalled()
    })

    it('triggers spec generation for quick-mode tasks (no spec)', async () => {
      // generatePrompt is mocked in beforeEach — just verify it gets called
      await useSprintTasks.getState().createTask({
        title: 'Quick task',
        repo: 'BDE',
        priority: 1
      })

      // generatePrompt is called asynchronously (fire and forget), so we need to flush
      await vi.waitFor(() => {
        expect(window.api.sprint.generatePrompt).toHaveBeenCalled()
      })
    })

    it('updates task with generated spec and shows toast.info', async () => {
      await useSprintTasks.getState().createTask({
        title: 'Quick task',
        repo: 'BDE',
        priority: 1
      })

      await vi.waitFor(() => {
        const task = useSprintTasks.getState().tasks.find((t) => t.id === 'server-id-1')
        expect(task?.spec).toBe('generated spec')
      })
      expect(toast.info).toHaveBeenCalled()
    })
  })

  describe('launchTask', () => {
    const task = makeTask('t1', { status: 'backlog', repo: 'bde' })

    beforeEach(() => {
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
      ;(window.api.getRepoPaths as ReturnType<typeof vi.fn>).mockResolvedValue({
        bde: '/repos/bde'
      })
      ;(window.api.spawnLocalAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'agent-99',
        pid: 5678,
        logPath: '/tmp/log',
        interactive: false
      })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    })

    it('spawns agent and updates task status to active on success', async () => {
      await useSprintTasks.getState().launchTask(task)

      expect(window.api.spawnLocalAgent).toHaveBeenCalledWith({
        task: task.title,
        repoPath: '/repos/bde'
      })
      const updated = useSprintTasks.getState().tasks[0]
      expect(updated.status).toBe('active')
      expect(updated.agent_run_id).toBe('agent-99')
      expect(toast.success).toHaveBeenCalledWith('Agent launched')
    })

    it('uses task.spec as agent task when spec is set', async () => {
      const taskWithSpec = makeTask('t2', { status: 'backlog', repo: 'bde', spec: 'do the thing' })
      useSprintTasks.setState({ tasks: [taskWithSpec], pendingUpdates: {}, pendingCreates: [] })

      await useSprintTasks.getState().launchTask(taskWithSpec)

      expect(window.api.spawnLocalAgent).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'do the thing' })
      )
    })

    it('shows error and returns early when repo path is not configured', async () => {
      ;(window.api.getRepoPaths as ReturnType<typeof vi.fn>).mockResolvedValue({})

      await useSprintTasks.getState().launchTask(task)

      expect(window.api.spawnLocalAgent).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('"bde"'))
    })

    it('blocks launch and shows toast when WIP limit is reached', async () => {
      // Fill WIP_LIMIT_IN_PROGRESS (5) active tasks
      const activeTasks = Array.from({ length: 5 }, (_, i) =>
        makeTask(`active-${i}`, { status: 'active', repo: 'bde' })
      )
      useSprintTasks.setState({
        tasks: [...activeTasks, task],
        pendingUpdates: {},
        pendingCreates: []
      })

      await useSprintTasks.getState().launchTask(task)

      expect(window.api.spawnLocalAgent).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('In Progress is full'))
    })

    it('does not apply WIP limit when task is already active', async () => {
      const alreadyActive = makeTask('t-active', { status: 'active', repo: 'bde' })
      const otherActiveTasks = Array.from({ length: 5 }, (_, i) =>
        makeTask(`active-${i}`, { status: 'active', repo: 'bde' })
      )
      useSprintTasks.setState({
        tasks: [...otherActiveTasks, alreadyActive],
        pendingUpdates: {},
        pendingCreates: []
      })

      // Should not block even though there are 5 active tasks
      await useSprintTasks.getState().launchTask(alreadyActive)

      expect(window.api.spawnLocalAgent).toHaveBeenCalled()
    })

    it('shows error toast when spawnLocalAgent throws', async () => {
      ;(window.api.spawnLocalAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('spawn failed')
      )

      await useSprintTasks.getState().launchTask(task)

      expect(toast.error).toHaveBeenCalledWith('spawn failed')
    })
  })

  describe('loadData — advanced cases', () => {
    it('preserves only pending fields from optimistic version during poll', async () => {
      const optimistic = makeTask('t1', { status: 'active', notes: 'local notes' })
      const pendingUpdates: Record<string, { ts: number; fields: string[] }> = {
        t1: { ts: Date.now(), fields: ['status'] }
      }
      useSprintTasks.setState({ tasks: [optimistic], pendingUpdates, pendingCreates: [] })

      // Poll returns stale status but has updated notes from server
      const stale = makeTask('t1', { status: 'backlog', notes: 'server notes' })
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([stale])

      await useSprintTasks.getState().loadData()

      // Pending field (status) should be preserved from local
      expect(useSprintTasks.getState().tasks[0].status).toBe('active')
      // Non-pending field (notes) should come from server
      expect(useSprintTasks.getState().tasks[0].notes).toBe('server notes')
    })

    it('expires pending update TTL and accepts incoming data', async () => {
      const optimistic = makeTask('t1', { status: 'active' })
      // Timestamp older than PENDING_UPDATE_TTL (2000ms)
      const oldTs = Date.now() - 3000
      const pendingUpdates: Record<string, { ts: number; fields: string[] }> = {
        t1: { ts: oldTs, fields: ['status'] }
      }
      useSprintTasks.setState({ tasks: [optimistic], pendingUpdates, pendingCreates: [] })

      const incoming = makeTask('t1', { status: 'done' })
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([incoming])

      await useSprintTasks.getState().loadData()

      // TTL expired — incoming data should win
      expect(useSprintTasks.getState().tasks[0].status).toBe('done')
    })

    it('merges field-by-field: pending fields from local, rest from server', async () => {
      const local = makeTask('t1', {
        status: 'active',
        priority: 1,
        notes: 'old local notes',
        claimed_by: 'agent-1'
      })
      const pendingUpdates: Record<string, { ts: number; fields: string[] }> = {
        t1: { ts: Date.now(), fields: ['status', 'claimed_by'] }
      }
      useSprintTasks.setState({ tasks: [local], pendingUpdates, pendingCreates: [] })

      // Server has updated priority and notes, but stale status
      const server = makeTask('t1', {
        status: 'backlog',
        priority: 5,
        notes: 'server notes',
        claimed_by: null
      })
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([server])

      await useSprintTasks.getState().loadData()

      const merged = useSprintTasks.getState().tasks[0]
      // Pending fields preserved from local
      expect(merged.status).toBe('active')
      expect(merged.claimed_by).toBe('agent-1')
      // Non-pending fields come from server
      expect(merged.priority).toBe(5)
      expect(merged.notes).toBe('server notes')
    })

    it('preserves pending-create temp tasks not yet in DB', async () => {
      const tempTask = makeTask('temp-999', { title: 'Brand new task' })
      const pendingCreates: string[] = ['temp-999']
      useSprintTasks.setState({ tasks: [tempTask], pendingUpdates: {}, pendingCreates })

      // DB response does not include temp task yet
      const dbTask = makeTask('server-1')
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([dbTask])

      await useSprintTasks.getState().loadData()

      const ids = useSprintTasks.getState().tasks.map((t) => t.id)
      expect(ids).toContain('temp-999')
      expect(ids).toContain('server-1')
    })
  })

  describe('updateTask — error path', () => {
    it('calls loadData to revert optimistic changes on failure', async () => {
      const task = makeTask('t1', { status: 'backlog' })
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('server error')
      )
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([task])

      await useSprintTasks.getState().updateTask('t1', { status: 'active' })

      // After revert, loadData should have been called (task restored to backlog)
      expect(window.api.sprint.list).toHaveBeenCalled()
    })

    it('removes taskId from pendingUpdates on failure', async () => {
      const task = makeTask('t1')
      useSprintTasks.setState({ tasks: [task], pendingUpdates: {}, pendingCreates: [] })
      ;(window.api.sprint.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'))
      ;(window.api.sprint.list as ReturnType<typeof vi.fn>).mockResolvedValue([task])

      await useSprintTasks.getState().updateTask('t1', { status: 'active' })

      expect('t1' in useSprintTasks.getState().pendingUpdates).toBe(false)
    })
  })

  describe('mergeSseUpdate — pr_status auto-set', () => {
    it('does not set pr_status when task is not done', () => {
      const task = makeTask('t1', { status: 'active', pr_url: null, pr_status: null })
      useSprintTasks.setState({ tasks: [task] })

      useSprintTasks.getState().mergeSseUpdate({
        taskId: 't1',
        status: 'active',
        pr_url: 'https://github.com/pr/1'
      })

      expect(useSprintTasks.getState().tasks[0].pr_status).toBeNull()
    })

    it('does not overwrite existing pr_status when done+pr_url', () => {
      const task = makeTask('t1', { status: 'active', pr_url: null, pr_status: 'merged' })
      useSprintTasks.setState({ tasks: [task] })

      useSprintTasks.getState().mergeSseUpdate({
        taskId: 't1',
        status: 'done',
        pr_url: 'https://github.com/pr/1'
      })

      // pr_status was already 'merged' — should not be overwritten to 'open'
      expect(useSprintTasks.getState().tasks[0].pr_status).toBe('merged')
    })
  })
})
