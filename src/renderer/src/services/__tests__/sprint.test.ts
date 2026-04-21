import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listTasks,
  updateTask,
  deleteTask,
  createTask,
  batchUpdate,
  generatePrompt
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
    const input = { title: 'New task', repo: 'bde', status: 'backlog' as const }
    await createTask(input as Parameters<typeof window.api.sprint.create>[0])
    expect(window.api.sprint.create).toHaveBeenCalledWith(input)
  })

  it('batchUpdate delegates to window.api.sprint.batchUpdate', async () => {
    const ops = [{ op: 'delete' as const, id: 't1' }]
    await batchUpdate(ops)
    expect(window.api.sprint.batchUpdate).toHaveBeenCalledWith(ops)
  })

  it('generatePrompt delegates to window.api.sprint.generatePrompt', async () => {
    const params = { taskId: 't1', title: 'task', repo: 'bde', templateHint: 'feature' }
    await generatePrompt(params)
    expect(window.api.sprint.generatePrompt).toHaveBeenCalledWith(params)
  })
})
