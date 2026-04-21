import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { DependencyIndex } from '../../services/dependency-service'
import { checkAndBlockDeps } from '../task-mapper'

function makeRepo(): IAgentTaskRepository {
  return { updateTask: vi.fn() } as unknown as IAgentTaskRepository
}

function makeDepIndex(overrides?: Partial<DependencyIndex>): DependencyIndex {
  return {
    rebuild: vi.fn(),
    getBlockedBy: vi.fn(),
    addEdges: vi.fn(),
    areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] }),
    ...overrides
  } as unknown as DependencyIndex
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

describe('checkAndBlockDeps (sanitizeDependsOn integration)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('treats malformed JSON as no-deps — does not throw, does not block', () => {
    // Previously: JSON.parse threw and the task was marked 'error'.
    // Now: sanitizeDependsOn returns null, so the drain loop proceeds normally.
    const repo = makeRepo()
    const depIndex = makeDepIndex()
    const result = checkAndBlockDeps('task-1', '{not valid json', new Map(), repo, depIndex, logger)
    expect(result).toBe(false)
    expect(repo.updateTask).not.toHaveBeenCalled()
    expect(depIndex.areDependenciesSatisfied).not.toHaveBeenCalled()
  })

  it('filters malformed entries out of a mixed array before calling the dep index', () => {
    const repo = makeRepo()
    const depIndex = makeDepIndex()
    const mixed = [
      { id: 'dep-1', type: 'hard' },
      { id: '', type: 'hard' },
      { id: 'dep-2', type: 'bogus' },
      null,
      { id: 'dep-3', type: 'soft' }
    ]
    checkAndBlockDeps('task-1', mixed, new Map(), repo, depIndex, logger)
    expect(depIndex.areDependenciesSatisfied).toHaveBeenCalledWith(
      'task-1',
      [
        { id: 'dep-1', type: 'hard' },
        { id: 'dep-3', type: 'soft' }
      ],
      expect.any(Function)
    )
  })

  it('auto-blocks the task when sanitized deps are unsatisfied', () => {
    const repo = makeRepo()
    const depIndex = makeDepIndex({
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValue({ satisfied: false, blockedBy: ['dep-1'] })
    })
    const deps = JSON.stringify([{ id: 'dep-1', type: 'hard' }])
    const result = checkAndBlockDeps('task-1', deps, new Map(), repo, depIndex, logger)
    expect(result).toBe(true)
    expect(repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'blocked' })
    )
  })
})
