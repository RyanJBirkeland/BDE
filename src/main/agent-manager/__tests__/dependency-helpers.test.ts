import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatBlockedNote, stripBlockedNote, buildBlockedNotes } from '../dependency-helpers'

// Mocks for checkTaskDependencies tests — must be declared before dynamic import
vi.mock('../../data/sprint-queries', () => ({
  listTasks: vi.fn()
}))
vi.mock('../dependency-index', () => ({
  createDependencyIndex: vi.fn()
}))

describe('formatBlockedNote', () => {
  it('formats blocked-by list with prefix', () => {
    expect(formatBlockedNote(['task-1', 'task-2'])).toBe('[auto-block] Blocked by: task-1, task-2')
  })

  it('handles single dependency', () => {
    expect(formatBlockedNote(['task-1'])).toBe('[auto-block] Blocked by: task-1')
  })
})

describe('stripBlockedNote', () => {
  it('removes auto-block prefix and returns user notes', () => {
    expect(stripBlockedNote('[auto-block] Blocked by: task-1\nUser notes here')).toBe(
      'User notes here'
    )
  })

  it('returns empty string for null', () => {
    expect(stripBlockedNote(null)).toBe('')
  })

  it('returns original text when no auto-block prefix', () => {
    expect(stripBlockedNote('Just user notes')).toBe('Just user notes')
  })

  it('returns empty string when only auto-block prefix', () => {
    expect(stripBlockedNote('[auto-block] Blocked by: task-1')).toBe('')
  })
})

describe('buildBlockedNotes', () => {
  it('builds note with just blocked-by when no existing notes', () => {
    expect(buildBlockedNotes(['task-1'])).toBe('[auto-block] Blocked by: task-1')
  })

  it('preserves existing user notes after blocked-by', () => {
    expect(buildBlockedNotes(['task-1'], 'User wrote this')).toBe(
      '[auto-block] Blocked by: task-1\nUser wrote this'
    )
  })

  it('strips old auto-block prefix from existing notes before rebuilding', () => {
    expect(buildBlockedNotes(['task-2'], '[auto-block] Blocked by: task-1\nOriginal notes')).toBe(
      '[auto-block] Blocked by: task-2\nOriginal notes'
    )
  })

  it('handles null existing notes', () => {
    expect(buildBlockedNotes(['task-1'], null)).toBe('[auto-block] Blocked by: task-1')
  })
})

describe('checkTaskDependencies', () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns shouldBlock: false when deps are satisfied', async () => {
    const { listTasks } = await import('../../data/sprint-queries')
    const { createDependencyIndex } = await import('../dependency-index')
    const { checkTaskDependencies } = await import('../dependency-helpers')

    vi.mocked(listTasks).mockResolvedValue([
      { id: 'task-1', status: 'queued' },
      { id: 'task-2', status: 'done' }
    ] as any)
    vi.mocked(createDependencyIndex).mockReturnValue({
      rebuild: vi.fn(),
      getDependents: vi.fn(),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
    })

    const result = await checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger
    )

    expect(result).toEqual({ shouldBlock: false, blockedBy: [] })
  })

  it('returns shouldBlock: true when dep is unsatisfied', async () => {
    const { listTasks } = await import('../../data/sprint-queries')
    const { createDependencyIndex } = await import('../dependency-index')
    const { checkTaskDependencies } = await import('../dependency-helpers')

    vi.mocked(listTasks).mockResolvedValue([
      { id: 'task-1', status: 'queued' },
      { id: 'task-2', status: 'queued' }
    ] as any)
    vi.mocked(createDependencyIndex).mockReturnValue({
      rebuild: vi.fn(),
      getDependents: vi.fn(),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: false, blockedBy: ['task-2'] })
    })

    const result = await checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger
    )

    expect(result).toEqual({ shouldBlock: true, blockedBy: ['task-2'] })
  })

  it('returns shouldBlock: false when listTasks fails (graceful degradation)', async () => {
    const { listTasks } = await import('../../data/sprint-queries')
    const { checkTaskDependencies } = await import('../dependency-helpers')

    vi.mocked(listTasks).mockRejectedValue(new Error('Supabase down'))

    const result = await checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger
    )

    expect(result).toEqual({ shouldBlock: false, blockedBy: [] })
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('checkTaskDependencies failed for task-1')
    )
  })
})
