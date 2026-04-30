import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReviewShipBatchService } from '../review-ship-batch'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../review-action-executor', () => ({
  executeReviewAction: vi.fn()
}))

vi.mock('../review-action-policy', () => ({
  classifyReviewAction: vi.fn()
}))

vi.mock('../sprint-service', () => ({
  getTask: vi.fn(),
  notifySprintMutation: vi.fn()
}))

vi.mock('../../paths', () => ({
  getRepoConfig: vi.fn(),
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
import { executeReviewAction } from '../review-action-executor'
import { classifyReviewAction } from '../review-action-policy'
import { getTask } from '../sprint-service'
import { getRepoConfig } from '../../paths'

const ENV = { PATH: '/usr/bin' }
const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

function makeRepo() {
  return {
    getTask: vi.fn().mockReturnValue({ id: 't1', status: 'done' }),
    updateTask: vi.fn().mockReturnValue({ id: 't1', status: 'done' })
  } as any
}

function makeTask(id: string, repo = 'fleet') {
  return {
    id,
    title: `Task ${id}`,
    repo,
    worktree_path: `/tmp/wt/${id}`,
    spec: '## Overview\n## Steps',
    notes: null,
    agent_run_id: `run-${id}`
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRepoConfig).mockReturnValue({
    name: 'fleet',
    localPath: '/Users/dev/fleet',
    githubOwner: 'owner',
    githubRepo: 'fleet'
  } as any)
  vi.mocked(classifyReviewAction).mockReturnValue({ gitOps: [], taskPatch: { status: 'done' }, terminalStatus: 'done' } as any)
  vi.mocked(executeReviewAction).mockResolvedValue({})
  vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })
})

// ---------------------------------------------------------------------------
// Batch success
// ---------------------------------------------------------------------------

describe('shipBatch — all tasks succeed', () => {
  it('merges all tasks and returns success with shippedTaskIds', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(makeTask('t1') as any)
      .mockReturnValueOnce(makeTask('t2') as any)

    const service = createReviewShipBatchService(makeRepo())
    const result = await service.shipBatch({
      taskIds: ['t1', 't2'],
      strategy: 'squash',
      env: ENV,
      onStatusTerminal
    })

    expect(result.success).toBe(true)
    expect(result.shippedTaskIds).toEqual(['t1', 't2'])
    expect(executeReviewAction).toHaveBeenCalledTimes(2)
    // Final push should have been called once
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'HEAD'],
      expect.objectContaining({ cwd: '/Users/dev/fleet' })
    )
  })
})

// ---------------------------------------------------------------------------
// Partial failure — abort on first failure
// ---------------------------------------------------------------------------

describe('shipBatch — first task fails', () => {
  it('aborts and returns the failed task id plus already-shipped ids', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(makeTask('t1') as any)
      .mockReturnValueOnce(makeTask('t2') as any)

    vi.mocked(executeReviewAction)
      .mockResolvedValueOnce({}) // t1 succeeds
      .mockRejectedValueOnce(new Error('Merge conflict in src/foo.ts')) // t2 fails

    const service = createReviewShipBatchService(makeRepo())
    const result = await service.shipBatch({
      taskIds: ['t1', 't2'],
      strategy: 'squash',
      env: ENV,
      onStatusTerminal
    })

    expect(result.success).toBe(false)
    expect(result.failedTaskId).toBe('t2')
    expect(result.shippedTaskIds).toEqual(['t1'])
    expect(result.error).toContain('Merge conflict')
    // push should NOT have been attempted after a merge failure
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Task not found
// ---------------------------------------------------------------------------

describe('shipBatch — task not found', () => {
  it('returns error immediately when a task id is missing', async () => {
    vi.mocked(getTask).mockReturnValue(null as any)

    const service = createReviewShipBatchService(makeRepo())
    const result = await service.shipBatch({
      taskIds: ['ghost-id'],
      strategy: 'squash',
      env: ENV,
      onStatusTerminal
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(executeReviewAction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Empty task list
// ---------------------------------------------------------------------------

describe('shipBatch — empty task list', () => {
  it('returns error when taskIds is empty', async () => {
    const service = createReviewShipBatchService(makeRepo())
    const result = await service.shipBatch({
      taskIds: [],
      strategy: 'squash',
      env: ENV,
      onStatusTerminal
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('at least one')
  })
})

// ---------------------------------------------------------------------------
// Mismatched repos
// ---------------------------------------------------------------------------

describe('shipBatch — mixed repos', () => {
  it('returns error when tasks span multiple repos', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(makeTask('t1', 'fleet') as any)
      .mockReturnValueOnce(makeTask('t2', 'other-repo') as any)

    const service = createReviewShipBatchService(makeRepo())
    const result = await service.shipBatch({
      taskIds: ['t1', 't2'],
      strategy: 'squash',
      env: ENV,
      onStatusTerminal
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('one repo')
    expect(executeReviewAction).not.toHaveBeenCalled()
  })
})
