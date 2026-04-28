import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { DependencyIndex } from '../../services/dependency-service'

vi.mock('../task-mapper', () => ({
  mapQueuedTask: vi.fn(),
  checkAndBlockDeps: vi.fn().mockReturnValue(false)
}))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
}))
vi.mock('../worktree', () => ({
  setupWorktree: vi.fn()
}))
vi.mock('../../../shared/time', () => ({
  nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z')
}))

import {
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
import { SpawnRegistry } from '../spawn-registry'
import type { TaskStateService } from '../../services/task-state-service'

function makeTask(overrides: Partial<MappedTask> = {}): MappedTask {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: null,
    spec: '## Goal\nDo stuff',
    repo: 'fleet',
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
    updateTask: vi.fn().mockResolvedValue(null),
    getTask: vi.fn().mockReturnValue({ id: 'task-1', status: opts.status ?? 'queued' }),
    claimTask: vi
      .fn()
      .mockResolvedValue(opts.claimResult !== undefined ? opts.claimResult : 'task-1'),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn().mockResolvedValue(null),
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

function makeTaskStateService(repo: ReturnType<typeof makeRepo>): TaskStateService {
  return {
    transition: vi.fn(async (taskId: string, status: string, ctx: { fields?: Record<string, unknown> } = {}) => {
      await repo.updateTask(taskId, { status, ...(ctx.fields ?? {}) })
      return { committed: true, dependentsResolved: true }
    })
  } as unknown as TaskStateService
}

function makeClaimerDeps(overrides: Partial<TaskClaimerDeps> = {}): TaskClaimerDeps {
  const repo = overrides.repo ?? makeRepo()
  return {
    config: {
      maxConcurrent: 2,
      worktreeBase: '/tmp/worktrees',
      maxRuntimeMs: 3_600_000,
      idleTimeoutMs: 900_000,
      pollIntervalMs: 30_000,
      defaultModel: DEFAULT_CONFIG.defaultModel
    },
    repo,
    depIndex: makeDepIndex(),
    logger: makeLogger(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    taskStateService: makeTaskStateService(repo),
    resolveRepoPath: (slug) => {
      const paths = getRepoPaths()
      return paths[slug.toLowerCase()] ?? null
    },
    ...overrides
  }
}

describe('resolveRepoPath callback (via makeClaimerDeps)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns path for known repo slug', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
    const deps = makeClaimerDeps()
    expect(deps.resolveRepoPath('fleet')).toBe('/Users/ryan/projects/FLEET')
  })

  it('returns null for unknown repo slug', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
    const deps = makeClaimerDeps()
    expect(deps.resolveRepoPath('unknown-repo')).toBeNull()
  })

  it('is case-insensitive (lowercases slug)', () => {
    vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
    const deps = makeClaimerDeps()
    expect(deps.resolveRepoPath('FLEET')).toBe('/Users/ryan/projects/FLEET')
  })
})

describe('validateAndClaimTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapQueuedTask).mockReturnValue(makeTask())
    vi.mocked(checkAndBlockDeps).mockReturnValue(false)
    vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
  })

  it('returns null when mapQueuedTask returns null', async () => {
    vi.mocked(mapQueuedTask).mockReturnValue(null)
    const deps = makeClaimerDeps()
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

  it('returns null when claimTask returns null (concurrent claim or status change)', async () => {
    const repo = makeRepo({ claimResult: null })
    const deps = makeClaimerDeps({ repo })
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).toBeNull()
    expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('could not be claimed'))
  })

  it('returns task and repoPath on successful claim', async () => {
    const deps = makeClaimerDeps()
    const result = await validateAndClaimTask({}, new Map(), deps)
    expect(result).not.toBeNull()
    expect(result?.task.id).toBe('task-1')
    expect(result?.repoPath).toBe('/Users/ryan/projects/FLEET')
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
    // TaskStateService.transition routes the error write through repo.updateTask in our test mock
    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
    // TaskStateService.transition fires the terminal dispatcher (onTaskTerminal) internally
    expect(deps.taskStateService.transition).toHaveBeenCalledWith(
      'task-1',
      'error',
      expect.objectContaining({ caller: 'worktree-setup-failure' })
    )
  })
})

describe('processQueuedTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapQueuedTask).mockReturnValue(makeTask())
    vi.mocked(checkAndBlockDeps).mockReturnValue(false)
    vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/Users/ryan/projects/FLEET' })
    vi.mocked(setupWorktree).mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'agent/task-1' })
  })

  function makeProcessDeps(overrides: Partial<ProcessQueuedTaskDeps> = {}): ProcessQueuedTaskDeps {
    return {
      ...makeClaimerDeps(),
      spawnRegistry: new SpawnRegistry(),
      spawnAgent: vi.fn(),
      ...overrides
    }
  }

  it('skips task if already in processingTasks (idempotency guard)', async () => {
    const spawnRegistry = new SpawnRegistry()
    spawnRegistry.markProcessing('task-1')
    const deps = makeProcessDeps({ spawnRegistry })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).not.toHaveBeenCalled()
  })

  it('calls spawnAgent on successful claim and worktree setup', async () => {
    const deps = makeProcessDeps()
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
      { worktreePath: '/tmp/wt', branch: 'agent/task-1' },
      '/Users/ryan/projects/FLEET'
    )
  })

  it('removes taskId from processingTasks after completion', async () => {
    const spawnRegistry = new SpawnRegistry()
    const deps = makeProcessDeps({ spawnRegistry })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(spawnRegistry.isProcessing('task-1')).toBe(false)
  })

  it('removes taskId from processingTasks even when an error occurs', async () => {
    vi.mocked(setupWorktree).mockRejectedValue(new Error('wt error'))
    const spawnRegistry = new SpawnRegistry()
    const deps = makeProcessDeps({ spawnRegistry })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(spawnRegistry.isProcessing('task-1')).toBe(false)
  })

  it('does not call spawnAgent when claim fails', async () => {
    const repo = makeRepo({ claimResult: null })
    const deps = makeProcessDeps({ repo })
    await processQueuedTask({ id: 'task-1' }, new Map(), deps)
    expect(deps.spawnAgent).not.toHaveBeenCalled()
  })
})
