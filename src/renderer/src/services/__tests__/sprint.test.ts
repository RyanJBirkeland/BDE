import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listTasks,
  updateTask,
  deleteTask,
  createTask,
  batchUpdate,
  generatePrompt,
  exportTasks,
  retryTask,
  unblockTask,
  forceFailTask,
  forceDoneTask,
  forceReleaseClaim
} from '../sprint'

describe('sprint service', () => {
  beforeEach(() => {
    vi.mocked(window.api.sprint.list).mockResolvedValue([])
    vi.mocked(window.api.sprint.update).mockResolvedValue(null)
    vi.mocked(window.api.sprint.delete).mockResolvedValue({ ok: true })

    vi.mocked(window.api.sprint.create).mockResolvedValue({} as any)
    vi.mocked(window.api.sprint.batchUpdate).mockResolvedValue({ results: [] })
    vi.mocked(window.api.sprint.generatePrompt).mockResolvedValue({
      taskId: '',
      spec: '',
      prompt: ''
    })
  })

  it('listTasks delegates to window.api.sprint.list', async () => {
    await listTasks()
    expect(window.api.sprint.list).toHaveBeenCalled()
  })

  it('updateTask passes taskId and patch', async () => {
    await updateTask('task-1', { status: 'done' })
    expect(window.api.sprint.update).toHaveBeenCalledWith('task-1', { status: 'done' })
  })

  it('deleteTask delegates to window.api.sprint.delete', async () => {
    await deleteTask('task-1')
    expect(window.api.sprint.delete).toHaveBeenCalledWith('task-1')
  })

  it('createTask delegates to window.api.sprint.create', async () => {
    const input = { title: 'New task', repo: 'fleet', status: 'backlog' as const }
    await createTask(input as Parameters<typeof window.api.sprint.create>[0])
    expect(window.api.sprint.create).toHaveBeenCalledWith(input)
  })

  it('batchUpdate delegates to window.api.sprint.batchUpdate', async () => {
    const ops = [{ op: 'delete' as const, id: 't1' }]
    await batchUpdate(ops)
    expect(window.api.sprint.batchUpdate).toHaveBeenCalledWith(ops)
  })

  it('generatePrompt delegates to window.api.sprint.generatePrompt', async () => {
    const params = { taskId: 't1', title: 'task', repo: 'fleet', templateHint: 'feature' }
    await generatePrompt(params)
    expect(window.api.sprint.generatePrompt).toHaveBeenCalledWith(params)
  })

  it('exportTasks delegates to window.api.sprint.exportTasks', async () => {
    vi.mocked(window.api.sprint.exportTasks).mockResolvedValue({ canceled: true })
    await exportTasks('json')
    expect(window.api.sprint.exportTasks).toHaveBeenCalledWith('json')
  })

  it('retryTask delegates to window.api.sprint.retry', async () => {
    vi.mocked(window.api.sprint.retry).mockResolvedValue(undefined as any)
    await retryTask('t1')
    expect(window.api.sprint.retry).toHaveBeenCalledWith('t1')
  })

  it('unblockTask delegates to window.api.sprint.unblockTask', async () => {
    vi.mocked(window.api.sprint.unblockTask).mockResolvedValue(undefined as any)
    await unblockTask('t1')
    expect(window.api.sprint.unblockTask).toHaveBeenCalledWith('t1')
  })

  it('forceFailTask delegates to window.api.sprint.forceFailTask', async () => {
    vi.mocked(window.api.sprint.forceFailTask).mockResolvedValue(undefined as any)
    await forceFailTask({ taskId: 't1', reason: 'r' })
    expect(window.api.sprint.forceFailTask).toHaveBeenCalledWith({ taskId: 't1', reason: 'r' })
  })

  it('forceDoneTask delegates to window.api.sprint.forceDoneTask', async () => {
    vi.mocked(window.api.sprint.forceDoneTask).mockResolvedValue(undefined as any)
    await forceDoneTask({ taskId: 't1', force: true })
    expect(window.api.sprint.forceDoneTask).toHaveBeenCalledWith({ taskId: 't1', force: true })
  })

  it('forceReleaseClaim delegates to window.api.sprint.forceReleaseClaim', async () => {
    vi.mocked(window.api.sprint.forceReleaseClaim).mockResolvedValue(undefined as any)
    await forceReleaseClaim('t1')
    expect(window.api.sprint.forceReleaseClaim).toHaveBeenCalledWith('t1')
  })
})
