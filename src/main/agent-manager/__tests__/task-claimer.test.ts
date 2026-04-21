import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { DependencyIndex } from '../../services/dependency-service'

vi.mock('../task-mapper', () => ({
  mapQueuedTask: vi.fn(),
  checkAndBlockDeps: vi.fn().mockReturnValue(false)
}))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
}))
vi.mock('../worktree', () => ({
  setupWorktree: vi.fn()
}))
vi.mock('../../../shared/time', () => ({
  nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z')
}))

import {
  resolveRepoPath,
  validateAndClaimTask,
  prepareWorktreeForTask,
  processQueuedTask,
  type TaskClaimerDeps,
  type ProcessQueuedTaskDeps
} from '../task-claimer'
import { mapQueuedTask, checkAndBlockDeps } from '../task-mapper'
import { getRepoPaths } from '../../paths'
import { setupWorktree } from '../worktree'
import type { MappedTask } from '../task-mapper'

function makeTask(overrides: Partial<MappedTask> = {}): MappedTask {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: null,
    spec: '## Goal\nDo stuff',
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    notes: null,
    playground_enabled: false,
    max_runtime_ms: null,
    max_cost_usd: null,
    model: null,
    group_id: null,
    ...overrides
  }
}

function makeRepo(
  opts: { status?: string; claimResult?: string | null } = {}
): IAgentTaskRepository {
  return {
    updateTask: vi.fn(),
    getTask: vi.fn().mockReturnValue({ id: 'task-1', status: opts.status ?? 'queued' }),
    claimTask: vi
      .fn()
      .mockReturnValue(opts.claimResult !== undefined ? opts.claimResult : 'task-1'),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn(),
    listActiveAgentRuns: vi.fn().mockReturnValue([])
  } as unknown as IAgentTaskRepository
}

function makeDepIndex(): DependencyIndex {
  return {
    rebuild: vi.fn(),
    getBlockedBy: vi.fn(),
    addEdges: vi.fn()
  } as unknown as DependencyIndex
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeClaimerDeps(overrides: Partial<TaskClaimerDeps> = {}): TaskClaimerDeps {
  return {
    config: {
      maxConcurrent: 2,
      worktreeBase: '/tmp/worktrees',
      maxRuntimeMs: 3_600_000,
      idleTimeoutMs: 900_000,
      pollIntervalMs: 30_000,
      defaultModel: 'claude-sonnet-4-5'
    },
    repo: makeRepo(),
    depIndex: makeDepIndex(),
    logger: makeLogger(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('resolveRepoPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns path for known repo slug', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
    expect(resolveRepoPath('bde')).toBe('/Users/ryan/projects/BDE')
  })

  it('returns null for unknown repo slug', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
    expect(resolveRepoPath('unknown-repo')).toBeNull()
  })

  it('is case-insensitive (lowercases slug)', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
    expect(resolveRepoPath('BDE')).toBe('/Users/ryan/projects/BDE')
  })
})

describe('validateAndClaimTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapQueuedTask).mockReturnValue(makeTask())
    vi.mocked(checkAndBlockDeps).mockReturnValue(false)
    vi.mocked(getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
  })

  it('returns null when mapQueuedTask returns null', async () => {
    vi.mocked(mapQueuedTask).mockReturnValue(null)
    const deps = makeClaimerDeps()
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
  })

  it('returns null when task status changed since fetch', async () => {
    const repo = makeRepo({ status: 'active' })
    const deps = makeClaimerDeps({ repo })
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('status changed since fetch')
    )
  })

  it('returns null when task is not found', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getTask).mockReturnValue(null)
    const deps = makeClaimerDeps({ repo })
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
  })

  it('returns null when deps are blocked', async () => {
    vi.mocked(checkAndBlockDeps).mockReturnValue(true)
    const raw = { depends_on: [{ id: 'dep-1', type: 'hard' }] }
    const deps = makeClaimerDeps()
    const result = await validateAndClaimTask(raw, new Map(), deps)
    expect(result).toBeNull()
  })

  it('sets task to error when repo path cannot be resolved', async () => {
    vi.mocked(getRepoPaths).mockReturnValue({})
    const deps = makeClaimerDeps()
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('returns null when claimTask returns null (already claimed)', async () => {
    const repo = makeRepo({ claimResult: null })
    const deps = makeClaimerDeps({ repo })
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
    expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('already claimed'))
  })

  it('returns task and repoPath on successful claim', async () => {
    const deps = makeClaimerDeps()
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).not.toBeNull()
    expect(result?.task.id).toBe('task-1')
    expect(result?.repoPath).toBe('/Users/ryan/projects/BDE')
  })
})

describe('prepareWorktreeForTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns worktree descriptor on success', async () => {
    vi.mocked(setupWorktree).mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'agent/task-1' })
    const deps = makeClaimerDeps()
    const result = await prepareWorktreeForTask(makeTask(), '/repo', deps)
    expect(result).toEqual({ worktreePath: '/tmp/wt', branch: 'agent/task-1' })
  })

  it('marks task as error and returns null when setupWorktree fails', async () => {
    vi.mocked(setupWorktree).mockRejectedValue(new Error('git error'))
    const deps = makeClaimerDeps()
    const result = await prepareWorktreeForTask(makeTask(), '/repo', deps)
    expect(result).toBeNull()
    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })
})

describe('processQueuedTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapQueuedTask).mockReturnValue(makeTask())
    vi.mocked(checkAndBlockDeps).mockReturnValue(false)
    vi.mocked(getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
    vi.mocked(setupWorktree).mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'agent/task-1' })
  })

  function makeProcessDeps(overrides: Partial<ProcessQueuedTaskDeps> = {}): ProcessQueuedTaskDeps {
    return {
      ...makeClaimerDeps(),
      processingTasks: new Set(),
      activeAgents: new Map(),
      spawnAgent: vi.fn(),
      ...overrides
    }
  }

  it('skips task if already in processingTasks (idempotency guard)', async () => {
    const processingTasks = new Set(['task-1'])
    const deps = makeProcessDeps({ processingTasks })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).not.toHaveBeenCalled()
  })

  it('calls spawnAgent on successful claim and worktree setup', async () => {
    const deps = makeProcessDeps()
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
      { worktreePath: '/tmp/wt', branch: 'agent/task-1' },
      '/Users/ryan/projects/BDE'
    )
  })

  it('removes taskId from processingTasks after completion', async () => {
    const processingTasks = new Set<string>()
    const deps = makeProcessDeps({ processingTasks })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(processingTasks.has('task-1')).toBe(false)
  })

  it('removes taskId from processingTasks even when an error occurs', async () => {
    vi.mocked(setupWorktree).mockRejectedValue(new Error('wt error'))
    const processingTasks = new Set<string>()
    const deps = makeProcessDeps({ processingTasks })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(processingTasks.has('task-1')).toBe(false)
  })

  it('does not call spawnAgent when claim fails', async () => {
    const repo = makeRepo({ claimResult: null })
    const deps = makeProcessDeps({ repo })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).not.toHaveBeenCalled()
  })
})
