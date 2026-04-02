/**
 * Shared task creation validation tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock sprint-queries
vi.mock('../../data/sprint-queries', () => ({
  listTasks: vi.fn().mockReturnValue([])
}))

// Mock dependency-helpers
vi.mock('../../agent-manager/dependency-helpers', () => ({
  buildBlockedNotes: vi.fn(
    (blockedBy: string[]) => `[auto-block] Blocked by: ${blockedBy.join(', ')}`
  ),
  checkTaskDependencies: vi.fn().mockReturnValue({ shouldBlock: false, blockedBy: [] })
}))

// Mock dependency-index (needed by dependency-helpers)
vi.mock('../../agent-manager/dependency-index', () => ({
  createDependencyIndex: vi.fn().mockReturnValue({
    areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true })
  })
}))

import { validateTaskCreation } from '../task-validation'
import { checkTaskDependencies } from '../../agent-manager/dependency-helpers'

const mockLogger = { warn: vi.fn() }

describe('validateTaskCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid backlog task with title and repo only', () => {
    const result = validateTaskCreation(
      { title: 'Fix bug', repo: 'bde', status: 'backlog' } as any,
      { logger: mockLogger }
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects task with empty title', () => {
    const result = validateTaskCreation({ title: '', repo: 'bde', status: 'backlog' } as any, {
      logger: mockLogger
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('title is required')
  })

  it('rejects task with empty repo', () => {
    const result = validateTaskCreation({ title: 'Fix', repo: '', status: 'backlog' } as any, {
      logger: mockLogger
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('repo is required')
  })

  it('rejects queued task without spec', () => {
    const result = validateTaskCreation({ title: 'Fix', repo: 'bde', status: 'queued' } as any, {
      logger: mockLogger
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('spec is required')
  })

  it('returns the original task when no blocking needed', () => {
    const input = { title: 'Fix', repo: 'bde', status: 'backlog' }
    const result = validateTaskCreation(input as any, { logger: mockLogger })
    expect(result.task).toEqual(input)
  })

  it('auto-blocks task with unsatisfied hard dependencies', () => {
    vi.mocked(checkTaskDependencies).mockReturnValue({
      shouldBlock: true,
      blockedBy: ['dep-1']
    })

    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const input = {
      title: 'Fix',
      repo: 'bde',
      status: 'queued',
      spec: validSpec,
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    const result = validateTaskCreation(input as any, { logger: mockLogger })

    expect(result.valid).toBe(true)
    expect(result.task.status).toBe('blocked')
    expect(result.task.notes).toContain('Blocked by: dep-1')
  })

  it('does not auto-block when dependencies are satisfied', () => {
    vi.mocked(checkTaskDependencies).mockReturnValue({
      shouldBlock: false,
      blockedBy: []
    })

    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const input = {
      title: 'Fix',
      repo: 'bde',
      status: 'queued',
      spec: validSpec,
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    const result = validateTaskCreation(input as any, { logger: mockLogger })

    expect(result.valid).toBe(true)
    expect(result.task.status).toBe('queued')
  })

  it('skips dependency check for backlog tasks', () => {
    const input = {
      title: 'Fix',
      repo: 'bde',
      status: 'backlog',
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    const result = validateTaskCreation(input as any, { logger: mockLogger })

    expect(result.valid).toBe(true)
    expect(checkTaskDependencies).not.toHaveBeenCalled()
  })

  it('uses provided listTasks override', () => {
    const customListTasks = vi.fn().mockReturnValue([])
    vi.mocked(checkTaskDependencies).mockReturnValue({
      shouldBlock: false,
      blockedBy: []
    })

    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const input = {
      title: 'Fix',
      repo: 'bde',
      status: 'queued',
      spec: validSpec,
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    validateTaskCreation(input as any, { logger: mockLogger, listTasks: customListTasks })

    expect(checkTaskDependencies).toHaveBeenCalledWith(
      'new-task',
      input.depends_on,
      expect.objectContaining({
        warn: mockLogger.warn,
        info: expect.any(Function),
        error: expect.any(Function)
      }),
      customListTasks
    )
  })
})
