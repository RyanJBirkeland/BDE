import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeReviewAction } from '../review-action-executor'
import type { ReviewActionDeps } from '../review-action-executor'
import type { ReviewActionPlan } from '../review-action-policy'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../review-merge-service', () => ({
  mergeAgentBranch: vi.fn(),
  cleanupWorktree: vi.fn(),
  executeMergeStrategy: vi.fn(),
  extractConflictFiles: vi.fn()
}))

vi.mock('../../lib/git-operations', () => ({
  rebaseOntoMain: vi.fn()
}))

vi.mock('../../lib/post-merge-dedup', () => ({
  runPostMergeDedup: vi.fn()
}))

vi.mock('../../paths', () => ({
  FLEET_TASK_MEMORY_DIR: '/tmp/fleet/task-memory'
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

import { execFileAsync } from '../../lib/async-utils'
import { cleanupWorktree } from '../review-merge-service'

const LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function makeDeps(overrides: Partial<ReviewActionDeps> = {}): ReviewActionDeps {
  return {
    repo: {
      getTask: vi.fn().mockReturnValue({ id: 'task-1', notes: '' }),
      updateTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'done' })
    },
    broadcast: vi.fn(),
    onStatusTerminal: vi.fn().mockResolvedValue(undefined),
    env: { PATH: '/usr/bin' },
    logger: LOGGER,
    ...overrides
  }
}

function makePlan(overrides: Partial<ReviewActionPlan> = {}): ReviewActionPlan {
  return {
    gitOps: [],
    taskPatch: undefined,
    terminalStatus: undefined,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Happy path — plan with no ops
// ---------------------------------------------------------------------------

describe('executeReviewAction — empty plan', () => {
  it('succeeds with an empty git ops list and no patch/terminal', async () => {
    const deps = makeDeps()
    const plan = makePlan()

    const state = await executeReviewAction(plan, 'task-1', deps)

    expect(deps.broadcast).not.toHaveBeenCalled()
    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
    expect(state).toMatchObject({})
  })
})

// ---------------------------------------------------------------------------
// Task patch application
// ---------------------------------------------------------------------------

describe('executeReviewAction — task patch', () => {
  it('applies task patch and broadcasts updated mutation', async () => {
    const deps = makeDeps()
    const plan = makePlan({ taskPatch: { status: 'done' } })

    await executeReviewAction(plan, 'task-1', deps)

    expect(deps.repo.updateTask).toHaveBeenCalledWith('task-1', { status: 'done' })
    expect(deps.broadcast).toHaveBeenCalledWith('sprint:mutation', {
      type: 'updated',
      task: expect.objectContaining({ id: 'task-1' })
    })
  })

  it('skips broadcast when updateTask returns null (task missing)', async () => {
    const deps = makeDeps({
      repo: {
        getTask: vi.fn().mockReturnValue(null),
        updateTask: vi.fn().mockReturnValue(null)
      }
    })
    const plan = makePlan({ taskPatch: { status: 'done' } })

    await executeReviewAction(plan, 'task-1', deps)

    expect(deps.broadcast).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Terminal status callback
// ---------------------------------------------------------------------------

describe('executeReviewAction — terminal status', () => {
  it('calls onStatusTerminal with the plan terminalStatus', async () => {
    const deps = makeDeps()
    const plan = makePlan({ terminalStatus: 'done' })

    await executeReviewAction(plan, 'task-1', deps)

    expect(deps.onStatusTerminal).toHaveBeenCalledWith('task-1', 'done')
  })

  it('does not call onStatusTerminal when terminalStatus is absent', async () => {
    const deps = makeDeps()
    const plan = makePlan({ terminalStatus: undefined })

    await executeReviewAction(plan, 'task-1', deps)

    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getBranch git op
// ---------------------------------------------------------------------------

describe('executeReviewAction — getBranch op', () => {
  it('reads current branch from git rev-parse', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'agent/t-1-fix\n', stderr: '' })
    const deps = makeDeps()
    const plan = makePlan({
      gitOps: [{ type: 'getBranch', worktreePath: '/tmp/worktree' }]
    })

    const state = await executeReviewAction(plan, 'task-1', deps)

    expect(state).toMatchObject({ branch: 'agent/t-1-fix' })
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.objectContaining({ cwd: '/tmp/worktree' })
    )
  })
})

// ---------------------------------------------------------------------------
// cleanup git op
// ---------------------------------------------------------------------------

describe('executeReviewAction — cleanup op', () => {
  it('calls cleanupWorktree with the branch captured by getBranch', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'agent/t-2-feature\n', stderr: '' })
    vi.mocked(cleanupWorktree).mockResolvedValue(undefined)

    const deps = makeDeps()
    const plan = makePlan({
      gitOps: [
        { type: 'getBranch', worktreePath: '/tmp/wt' },
        { type: 'cleanup', worktreePath: '/tmp/wt', repoPath: '/Users/dev/repo' }
      ]
    })

    await executeReviewAction(plan, 'task-1', deps)

    expect(cleanupWorktree).toHaveBeenCalledWith(
      '/tmp/wt',
      'agent/t-2-feature',
      '/Users/dev/repo',
      deps.env
    )
  })
})

// ---------------------------------------------------------------------------
// Failure — git op throws
// ---------------------------------------------------------------------------

describe('executeReviewAction — git op failure', () => {
  it('propagates the error thrown by a git op', async () => {
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not a git repository'))
    const deps = makeDeps()
    const plan = makePlan({
      gitOps: [{ type: 'getBranch', worktreePath: '/no/such/path' }]
    })

    await expect(executeReviewAction(plan, 'task-1', deps)).rejects.toThrow(
      'not a git repository'
    )
    // No task patch applied, no terminal callback fired
    expect(deps.repo.updateTask).not.toHaveBeenCalled()
    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
  })
})
