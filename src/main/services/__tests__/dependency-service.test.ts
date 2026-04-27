import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  formatBlockedNote,
  stripBlockedNote,
  buildBlockedNotes,
  computeBlockState
} from '../dependency-service'

// Mock for createDependencyIndex used by checkTaskDependencies
vi.mock('../dependency-service', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createDependencyIndex: vi.fn()
  }
})

// Shared mock logger used across checkTaskDependencies and checkEpicDependencies tests
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns shouldBlock: false when deps are satisfied', async () => {
    const { createDependencyIndex } = await import('../dependency-service')
    const { checkTaskDependencies } = await import('../dependency-service')

    const mockListTasks = vi.fn().mockReturnValue([
      { id: 'task-1', status: 'queued' },
      { id: 'task-2', status: 'done' }
    ] as any)
    vi.mocked(createDependencyIndex).mockReturnValue({
      rebuild: vi.fn(),
      getDependents: vi.fn(),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
    })

    const result = checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger,
      mockListTasks
    )

    expect(result).toEqual({ shouldBlock: false, blockedBy: [] })
  })

  it('returns shouldBlock: true when dep is unsatisfied', async () => {
    const { createDependencyIndex } = await import('../dependency-service')
    const { checkTaskDependencies } = await import('../dependency-service')

    const mockListTasks = vi.fn().mockReturnValue([
      { id: 'task-1', status: 'queued' },
      { id: 'task-2', status: 'queued' }
    ] as any)
    vi.mocked(createDependencyIndex).mockReturnValue({
      rebuild: vi.fn(),
      getDependents: vi.fn(),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: false, blockedBy: ['task-2'] })
    })

    const result = checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger,
      mockListTasks
    )

    expect(result).toEqual({ shouldBlock: true, blockedBy: ['task-2'] })
  })

  it('returns shouldBlock: true with dep-check-failed reason when listTasks throws (fail-closed)', async () => {
    const { checkTaskDependencies } = await import('../dependency-service')

    const mockListTasks = vi.fn().mockImplementation(() => {
      throw new Error('DB error')
    })

    const result = checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger,
      mockListTasks
    )

    expect(result.shouldBlock).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/^dep-check-failed: /)
    expect(result.reason).toContain('DB error')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('checkTaskDependencies failed for task-1')
    )
    expect(mockLogger.event).toHaveBeenCalledWith('dependency.check.error', expect.objectContaining({ taskId: 'task-1' }))
  })

  it('returns shouldBlock: true with dep-check-failed reason when listTasks throws', async () => {
    const { checkTaskDependencies } = await import('../dependency-service')
    const mockListTasks = vi.fn().mockImplementation(() => {
      throw new Error('index corrupt')
    })

    const result = checkTaskDependencies(
      'task-1',
      [{ id: 'task-2', type: 'hard' }],
      mockLogger,
      mockListTasks
    )

    expect(result.shouldBlock).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/^dep-check-failed: /)
    expect(result.reason).toContain('index corrupt')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('checkTaskDependencies failed for task-1')
    )
  })
})

describe('computeBlockState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return not blocked when no deps and no epic deps', () => {
    const task = { id: 'task-1', depends_on: null, group_id: null }
    const ctx = {
      logger: mockLogger,
      listTasks: () => [],
      listGroups: () => []
    }

    const result = computeBlockState(task, ctx)
    expect(result).toEqual({ shouldBlock: false, blockedBy: [] })
  })

  it('should return blocked by task deps when task deps unsatisfied', () => {
    const task = {
      id: 'task-1',
      depends_on: [{ id: 'task-2', type: 'hard' }],
      group_id: null
    }
    const ctx = {
      logger: mockLogger,
      listTasks: () => [
        { id: 'task-1', status: 'blocked', depends_on: null, group_id: null },
        { id: 'task-2', status: 'queued', depends_on: null, group_id: null }
      ],
      listGroups: () => []
    }

    const result = computeBlockState(task, ctx)
    expect(result.shouldBlock).toBe(true)
    expect(result.blockedBy).toEqual(['task-2'])
  })

  it('should return blocked by epic deps with epic: prefix when epic deps unsatisfied', () => {
    const task = {
      id: 'task-1',
      depends_on: null,
      group_id: 'epic-2'
    }
    const ctx = {
      logger: mockLogger,
      listTasks: () => [
        { id: 'task-1', status: 'queued', depends_on: null, group_id: 'epic-2' },
        { id: 'task-in-epic-1', status: 'queued', depends_on: null, group_id: 'epic-1' }
      ],
      listGroups: () => [
        {
          id: 'epic-1',
          name: 'Epic 1',
          status: 'in-pipeline',
          depends_on: null,
          icon: '',
          accent_color: '',
          goal: null,
          created_at: '',
          updated_at: ''
        },
        {
          id: 'epic-2',
          name: 'Epic 2',
          status: 'in-pipeline',
          depends_on: [{ id: 'epic-1', condition: 'on_success' }],
          icon: '',
          accent_color: '',
          goal: null,
          created_at: '',
          updated_at: ''
        }
      ]
    }

    const result = computeBlockState(task, ctx)
    expect(result.shouldBlock).toBe(true)
    expect(result.blockedBy).toEqual(['epic:epic-1'])
  })

  it('should combine task and epic blockers when both unsatisfied', () => {
    const task = {
      id: 'task-1',
      depends_on: [{ id: 'task-2', type: 'hard' }],
      group_id: 'epic-2'
    }
    const ctx = {
      logger: mockLogger,
      listTasks: () => [
        { id: 'task-1', status: 'blocked', depends_on: null, group_id: 'epic-2' },
        { id: 'task-2', status: 'queued', depends_on: null, group_id: null },
        { id: 'task-in-epic-1', status: 'queued', depends_on: null, group_id: 'epic-1' }
      ],
      listGroups: () => [
        {
          id: 'epic-1',
          name: 'Epic 1',
          status: 'in-pipeline',
          depends_on: null,
          icon: '',
          accent_color: '',
          goal: null,
          created_at: '',
          updated_at: ''
        },
        {
          id: 'epic-2',
          name: 'Epic 2',
          status: 'in-pipeline',
          depends_on: [{ id: 'epic-1', condition: 'on_success' }],
          icon: '',
          accent_color: '',
          goal: null,
          created_at: '',
          updated_at: ''
        }
      ]
    }

    const result = computeBlockState(task, ctx)
    expect(result.shouldBlock).toBe(true)
    expect(result.blockedBy).toEqual(['task-2', 'epic:epic-1'])
  })

  it('surfaces reason in result when checkTaskDependencies returns a fail-closed result', () => {
    // listTasks throws so checkTaskDependencies enters its catch and returns shouldBlock: true + reason
    const task = { id: 'task-1', depends_on: [{ id: 'task-2', type: 'hard' }], group_id: null }
    const ctx = {
      logger: mockLogger,
      listTasks: () => { throw new Error('listTasks exploded') },
      listGroups: () => []
    }

    const result = computeBlockState(task, ctx)

    expect(result.shouldBlock).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/^dep-check-failed: /)
    expect(result.reason).toContain('listTasks exploded')
  })
})

describe('checkEpicDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns shouldBlock: false with no reason when epicDeps is empty', async () => {
    const { checkEpicDependencies } = await import('../dependency-service')

    const result = checkEpicDependencies('epic-1', [], mockLogger, () => [], () => [])

    expect(result.shouldBlock).toBe(false)
    expect(result.blockedBy).toEqual([])
    expect(result.reason).toBeUndefined()
    expect(mockLogger.event).not.toHaveBeenCalled()
  })

  it('returns shouldBlock: true with dep-check-failed reason when listGroups throws', async () => {
    const { checkEpicDependencies } = await import('../dependency-service')

    const listGroups = vi.fn().mockImplementation(() => { throw new Error('groups DB down') })

    const result = checkEpicDependencies(
      'epic-2',
      [{ id: 'epic-1', condition: 'on_success' }],
      mockLogger,
      () => [],
      listGroups
    )

    expect(result.shouldBlock).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/^dep-check-failed: /)
    expect(result.reason).toContain('groups DB down')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('checkEpicDependencies failed for epic epic-2')
    )
    expect(mockLogger.event).toHaveBeenCalledWith('dependency.check.error', expect.objectContaining({ groupId: 'epic-2' }))
  })

  it('returns shouldBlock: true with dep-check-failed reason when listTasks throws', async () => {
    const { checkEpicDependencies } = await import('../dependency-service')

    const listTasks = vi.fn().mockImplementation(() => { throw new Error('tasks DB down') })
    const listGroups = vi.fn().mockReturnValue([
      { id: 'epic-1', status: 'in-pipeline', depends_on: null }
    ] as any)

    const result = checkEpicDependencies(
      'epic-2',
      [{ id: 'epic-1', condition: 'on_success' }],
      mockLogger,
      listTasks,
      listGroups
    )

    expect(result.shouldBlock).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/^dep-check-failed: /)
    expect(result.reason).toContain('tasks DB down')
    expect(mockLogger.event).toHaveBeenCalledWith('dependency.check.error', expect.objectContaining({ groupId: 'epic-2' }))
  })
})
