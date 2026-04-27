import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../sprint-mutations', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn().mockReturnValue([])
}))
vi.mock('../task-validation', () => ({
  validateTaskCreation: vi.fn().mockResolvedValue({ valid: true })
}))
vi.mock('../spec-quality/index', () => ({
  validateTaskSpec: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../data/task-group-queries', () => ({
  listGroups: vi.fn().mockReturnValue([])
}))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/repos/bde' })
}))
vi.mock('../dependency-service', () => ({
  computeBlockState: vi.fn().mockReturnValue({ shouldBlock: false, blockedBy: [] }),
  buildBlockedNotes: vi.fn().mockReturnValue('blocked note')
}))

import { updateTaskFromUi, createTaskWithValidation } from '../sprint-use-cases'
import { getTask, updateTask, createTask as mockCreateTask } from '../sprint-mutations'

const TASK = { id: 't1', status: 'queued', title: 'Test', repo: 'bde', spec: '## Overview\n## Steps', depends_on: null }

const mockTransition = vi.fn().mockResolvedValue(undefined)
const mockUpdateTask = vi.fn().mockReturnValue(TASK)
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
const taskStateService = { transition: mockTransition } as never

function makeDeps() {
  return { logger, taskStateService, updateTask: mockUpdateTask }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTask).mockReturnValue(TASK as never)
  vi.mocked(updateTask).mockReturnValue(TASK as never)
})

describe('updateTaskFromUi', () => {
  it('throws on invalid task id', async () => {
    await expect(updateTaskFromUi('', { title: 'x' }, makeDeps())).rejects.toThrow('Invalid task ID')
  })

  it('throws when patch has no allowlisted fields', async () => {
    await expect(updateTaskFromUi('t1', { badField: 'x' }, makeDeps())).rejects.toThrow('No valid fields')
  })

  it('routes status change through taskStateService.transition', async () => {
    await updateTaskFromUi('t1', { status: 'done' }, makeDeps())
    expect(mockTransition).toHaveBeenCalledWith('t1', 'done', expect.objectContaining({ caller: 'ui' }))
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('uses plain updateTask when no status change', async () => {
    await updateTaskFromUi('t1', { title: 'Updated' }, makeDeps())
    expect(mockTransition).not.toHaveBeenCalled()
    expect(mockUpdateTask).toHaveBeenCalledWith('t1', { title: 'Updated' })
  })

  it('throws on invalid status value', async () => {
    await expect(updateTaskFromUi('t1', { status: 'bogus' }, makeDeps())).rejects.toThrow('Invalid status')
  })

  it('queued transition auto-blocks when hard deps unsatisfied', async () => {
    const { computeBlockState } = await import('../dependency-service')
    vi.mocked(computeBlockState).mockReturnValue({ shouldBlock: true, blockedBy: ['dep-1'] })
    await updateTaskFromUi('t1', { status: 'queued' }, makeDeps())
    expect(mockTransition).toHaveBeenCalledWith(
      't1', 'blocked', expect.anything()
    )
  })

  it('queued transition uses queued status when deps satisfied', async () => {
    const { computeBlockState } = await import('../dependency-service')
    vi.mocked(computeBlockState).mockReturnValue({ shouldBlock: false, blockedBy: [] })
    await updateTaskFromUi('t1', { status: 'queued' }, makeDeps())
    expect(mockTransition).toHaveBeenCalledWith('t1', 'queued', expect.anything())
  })

  it('strips disallowed fields from patch', async () => {
    await updateTaskFromUi('t1', { title: 'Ok', some_internal_field: 'hack' } as never, makeDeps())
    const call = mockUpdateTask.mock.calls[0]
    expect(call[1]).not.toHaveProperty('some_internal_field')
    expect(call[1]).toHaveProperty('title', 'Ok')
  })

  it('passes notes field through to plain update', async () => {
    await updateTaskFromUi('t1', { notes: 'context' }, makeDeps())
    expect(mockUpdateTask).toHaveBeenCalledWith('t1', { notes: 'context' })
  })

  it('status change excludes status from taskStateService fields', async () => {
    await updateTaskFromUi('t1', { status: 'done', notes: 'shipped' }, makeDeps())
    const call = mockTransition.mock.calls[0]
    expect(call[2]?.fields).not.toHaveProperty('status')
    expect(call[2]?.fields).toHaveProperty('notes', 'shipped')
  })

  it('returns null when getTask returns null after transition', async () => {
    vi.mocked(getTask).mockReturnValue(null)
    const result = await updateTaskFromUi('t1', { status: 'done' }, makeDeps())
    expect(result).toBeNull()
  })

  it('strips fields not in UPDATE_ALLOWLIST from patch before calling updateTask', async () => {
    await updateTaskFromUi('t1', { title: 'ok', invented_field: 'bad' } as never, makeDeps())
    expect(mockUpdateTask).toHaveBeenCalledWith('t1', { title: 'ok' })
    expect(mockUpdateTask.mock.calls[0][1]).not.toHaveProperty('invented_field')
  })

  it('queued-to-blocked redirect carries blockedNotes in transition fields', async () => {
    const { computeBlockState, buildBlockedNotes } = await import('../dependency-service')
    vi.mocked(computeBlockState).mockReturnValue({ shouldBlock: true, blockedBy: ['dep-1'] })
    vi.mocked(buildBlockedNotes).mockReturnValue('blocked: dep-1')
    await updateTaskFromUi('t1', { status: 'queued' }, makeDeps())
    expect(mockTransition).toHaveBeenCalledWith(
      't1',
      'blocked',
      expect.objectContaining({
        fields: expect.objectContaining({ notes: 'blocked: dep-1' }),
        caller: 'ui'
      })
    )
  })

  it('status change with concurrent field update sends fields to transition not updateTask', async () => {
    await updateTaskFromUi('t1', { status: 'active', notes: 'starting' }, makeDeps())
    expect(mockTransition).toHaveBeenCalledWith('t1', 'active', {
      fields: { notes: 'starting' },
      caller: 'ui'
    })
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })
})

describe('createTaskWithValidation — auto-blocking (T-6)', () => {
  it('creates task as blocked when hard dep on non-done task', async () => {
    const depTask = { id: 'dep-1', status: 'queued', depends_on: null }
    const input = {
      title: 'Downstream task', repo: 'bde', status: 'queued' as const,
      spec: '## Overview\nDo something\n## Steps\nStep 1',
      depends_on: [{ id: 'dep-1', type: 'hard' as const }],
      priority: 1, needs_review: true, playground_enabled: false
    }
    const { validateTaskCreation } = await import('../task-validation')
    vi.mocked(validateTaskCreation).mockReturnValue({
      valid: true, errors: [],
      task: { ...input, status: 'blocked' }
    } as never)
    vi.mocked(mockCreateTask).mockImplementation(async (inp) => ({ ...inp, id: 'new-task' } as never))
    vi.mocked(getTask).mockImplementation((id) => id === 'dep-1' ? depTask as never : null)

    const result = await createTaskWithValidation(input, { logger })
    expect(result.status).toBe('blocked')
  })
})
