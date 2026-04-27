/**
 * Tests for task-state-service: validateTransition (re-export) and TaskStateService.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateTransition, createTaskStateService, InvalidTransitionError } from '../task-state-service'

// Mock sprint-mutations so TaskStateService never touches SQLite
vi.mock('../sprint-mutations', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn()
}))

// Mock sleep so retry tests don't actually wait 200ms
vi.mock('../../lib/async-utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined)
}))

// sprint-mutations is mocked, but we need to import after mock registration
import { getTask, updateTask } from '../sprint-mutations'

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

describe('validateTransition', () => {
  describe('valid transitions', () => {
    it('should allow backlog → queued', () => {
      const result = validateTransition('backlog', 'queued')
      expect(result).toEqual({ ok: true })
    })

    it('should allow active → review', () => {
      const result = validateTransition('active', 'review')
      expect(result).toEqual({ ok: true })
    })

    it('should allow review → done', () => {
      const result = validateTransition('review', 'done')
      expect(result).toEqual({ ok: true })
    })

    it('should allow failed → queued (retry)', () => {
      const result = validateTransition('failed', 'queued')
      expect(result).toEqual({ ok: true })
    })

    it('should allow active → queued (reset)', () => {
      const result = validateTransition('active', 'queued')
      expect(result).toEqual({ ok: true })
    })
  })

  describe('invalid transitions', () => {
    it('should reject backlog → done', () => {
      const result = validateTransition('backlog', 'done')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('Invalid transition')
        expect(result.reason).toContain('backlog → done')
        expect(result.reason).toContain('Allowed:')
      }
    })

    it('should allow queued → done (auto-complete path added in EP-1)', () => {
      const result = validateTransition('queued', 'done')
      expect(result.ok).toBe(true)
    })

    it('should reject cancelled → queued (re-queueing a cancelled task is not allowed)', () => {
      const result = validateTransition('cancelled', 'queued')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('cancelled → queued')
        // cancelled now permits → done as a manual recovery escape; only that
        // single transition is allowed, so the error message should list it.
        expect(result.reason).toContain('Allowed: done')
      }
    })

    it('should reject done → active (terminal except cancel)', () => {
      const result = validateTransition('done', 'active')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('done → active')
      }
    })

    it('should allow review → failed (added for markFailed review action)', () => {
      const result = validateTransition('review', 'failed')
      expect(result.ok).toBe(true)
    })
  })

  describe('error messages', () => {
    it('should include allowed transitions in error message', () => {
      const result = validateTransition('active', 'backlog')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        // active allows: review, done, failed, error, cancelled, queued
        expect(result.reason).toMatch(/Allowed:.*review/)
        expect(result.reason).toMatch(/done/)
        expect(result.reason).toMatch(/queued/)
      }
    })

    it('now permits cancelled → done as a manual recovery escape hatch', () => {
      // Previously cancelled was a true sink; painpoint #3 from the 2026-04-24
      // RCA added the escape hatch so humans can mark a task done after
      // implementing the work outside the pipeline.
      const result = validateTransition('cancelled', 'done')
      expect(result.ok).toBe(true)
    })
  })
})

// ---- TaskStateService -------------------------------------------------------

describe('TaskStateService', () => {
  const mockGetTask = vi.mocked(getTask)
  const mockUpdateTask = vi.mocked(updateTask)

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: getTask returns a task for re-fetch (used by annotation helper)
    mockUpdateTask.mockReturnValue({ id: 't1', status: 'done', notes: null } as ReturnType<typeof updateTask>)
  })

  function makeService(dispatchFn: (id: string, status: string) => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
    const dispatcher = { dispatch: dispatchFn }
    return { service: createTaskStateService({ terminalDispatcher: dispatcher, logger: fakeLogger }), dispatcher }
  }

  it('performs a valid transition and writes the status field', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)

    const { service } = makeService()
    await service.transition('t1', 'review')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'review' }),
      expect.objectContaining({ caller: 'task-state-service' })
    )
  })

  it('merges extra fields from ctx.fields into the DB patch', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)

    const { service } = makeService()
    await service.transition('t1', 'done', { fields: { completed_at: '2026-01-01' } })

    expect(mockUpdateTask).toHaveBeenCalledWith(
      't1',
      { status: 'done', completed_at: '2026-01-01' },
      expect.anything()
    )
  })

  it('throws InvalidTransitionError for a forbidden transition without writing to the DB', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'done' } as ReturnType<typeof getTask>)

    const { service } = makeService()
    await expect(service.transition('t1', 'active')).rejects.toBeInstanceOf(InvalidTransitionError)
    // The status write itself should not occur (transition guard fires first)
    const statusWrites = mockUpdateTask.mock.calls.filter(([, patch]) => 'status' in patch)
    expect(statusWrites).toHaveLength(0)
  })

  it('calls TerminalDispatcher.dispatch exactly once after a terminal write', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn().mockResolvedValue(undefined)
    const { service } = makeService(dispatchFn)
    await service.transition('t1', 'done')

    expect(dispatchFn).toHaveBeenCalledTimes(1)
    expect(dispatchFn).toHaveBeenCalledWith('t1', 'done')
  })

  // ---- 5.5 Non-terminal transition → clean result, dispatch not called --------

  it('does not call TerminalDispatcher for a non-terminal transition and returns { committed: true, dependentsResolved: true }', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'queued' } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn().mockResolvedValue(undefined)
    const { service } = makeService(dispatchFn)
    const result = await service.transition('t1', 'active')

    expect(dispatchFn).not.toHaveBeenCalled()
    expect(result).toEqual({ committed: true, dependentsResolved: true })
  })

  it('throws when the task is not found', async () => {
    mockGetTask.mockReturnValue(null)

    const { service } = makeService()
    await expect(service.transition('missing', 'queued')).rejects.toThrow('not found')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  // ---- 5.1 dispatch succeeds on first attempt → clean result, no retry -------

  it('returns { committed: true, dependentsResolved: true } when dispatch succeeds on first attempt', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn().mockResolvedValue(undefined)
    const { service } = makeService(dispatchFn)
    const result = await service.transition('t1', 'done')

    expect(dispatchFn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ committed: true, dependentsResolved: true })
  })

  // ---- 5.2 dispatch throws once, succeeds on retry ----------------------------

  it('returns { committed: true, dependentsResolved: true } when dispatch succeeds on retry', async () => {
    mockGetTask.mockReturnValue({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    const { service } = makeService(dispatchFn)
    const result = await service.transition('t1', 'done')

    expect(dispatchFn).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ committed: true, dependentsResolved: true })
  })

  // ---- 5.3 dispatch throws on both attempts → degraded result + annotation ---

  it('returns { committed: true, dependentsResolved: false, dispatchError } when dispatch fails both attempts', async () => {
    mockGetTask
      .mockReturnValueOnce({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)
      .mockReturnValue({ id: 't1', status: 'done', notes: null } as ReturnType<typeof getTask>)

    const dispatchError = new Error('dep-index offline')
    const dispatchFn = vi.fn().mockRejectedValue(dispatchError)
    const { service } = makeService(dispatchFn)
    const result = await service.transition('t1', 'done')

    expect(dispatchFn).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ committed: true, dependentsResolved: false, dispatchError })
  })

  it('calls updateTask with notes containing "terminal-dispatch-failed" when dispatch fails persistently', async () => {
    mockGetTask
      .mockReturnValueOnce({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)
      .mockReturnValue({ id: 't1', status: 'done', notes: null } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn().mockRejectedValue(new Error('boom'))
    const { service } = makeService(dispatchFn)
    await service.transition('t1', 'done')

    const annotationCall = mockUpdateTask.mock.calls.find(
      ([_id, patch]) => typeof patch.notes === 'string' && patch.notes.includes('terminal-dispatch-failed')
    )
    expect(annotationCall).toBeDefined()
  })

  // ---- 5.4 existing notes are preserved (annotation appended) ----------------

  it('appends annotation to existing notes instead of replacing them', async () => {
    mockGetTask
      .mockReturnValueOnce({ id: 't1', status: 'active' } as ReturnType<typeof getTask>)
      .mockReturnValue({ id: 't1', status: 'done', notes: 'some existing notes' } as ReturnType<typeof getTask>)

    const dispatchFn = vi.fn().mockRejectedValue(new Error('boom'))
    const { service } = makeService(dispatchFn)
    await service.transition('t1', 'done')

    const annotationCall = mockUpdateTask.mock.calls.find(
      ([_id, patch]) => typeof patch.notes === 'string' && patch.notes.includes('terminal-dispatch-failed')
    )
    expect(annotationCall).toBeDefined()
    const [, patch] = annotationCall!
    expect(patch.notes).toContain('some existing notes')
    expect(patch.notes).toContain('terminal-dispatch-failed')
  })
})
