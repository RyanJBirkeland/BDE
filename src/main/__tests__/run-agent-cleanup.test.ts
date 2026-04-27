import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock heavy dependencies before importing from run-agent
vi.mock('../agent-manager/worktree', () => ({
  cleanupWorktree: vi.fn(),
  setupWorktree: vi.fn(),
  pruneStaleWorktrees: vi.fn()
}))

vi.mock('../lib/async-utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  execFileAsync: vi.fn()
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  logError: vi.fn()
}))

vi.mock('../agent-manager/worktree-lifecycle', () => ({
  addWorktree: vi.fn(),
  cleanupWorktreeAndBranch: vi.fn()
}))

vi.mock('../agent-manager/partial-diff-capture', () => ({
  capturePartialDiff: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../agent-manager/prompt-assembly', () => ({
  validateTaskForRun: vi.fn(),
  assembleRunContext: vi.fn().mockResolvedValue('prompt'),
  fetchUpstreamContext: vi.fn(),
  readPriorScratchpad: vi.fn()
}))

vi.mock('../agent-manager/message-consumer', () => ({
  consumeMessages: vi.fn()
}))

vi.mock('../agent-manager/agent-telemetry', () => ({
  persistAgentRunTelemetry: vi.fn()
}))

vi.mock('../agent-manager/spawn-and-wire', () => ({
  spawnAndWireAgent: vi.fn()
}))

vi.mock('../agent-event-mapper', () => ({
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('../agent-manager/completion', () => ({
  resolveSuccess: vi.fn().mockResolvedValue(undefined),
  resolveFailure: vi.fn().mockReturnValue(false)
}))

vi.mock('../agent-manager/fast-fail', () => ({
  classifyExit: vi.fn().mockReturnValue('normal')
}))

vi.mock('../paths', () => ({
  getGhRepo: vi.fn().mockReturnValue('owner/repo'),
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/repo' })
}))

vi.mock('../agent-manager/spawn-sdk', async () => {
  const actual = await vi.importActual<typeof import('../agent-manager/spawn-sdk')>(
    '../agent-manager/spawn-sdk'
  )
  return {
    MAX_TURNS: actual.MAX_TURNS
  }
})

vi.mock('../../../shared/time', () => ({
  nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z')
}))

import { cleanupWorktreeWithRetry } from '../agent-manager/run-agent'
import { cleanupWorktree } from '../agent-manager/worktree'
import { sleep } from '../lib/async-utils'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'

function makeRepo(overrides: Partial<IAgentTaskRepository> = {}): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'error', notes: null }),
    updateTask: vi.fn().mockResolvedValue(null),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    ...overrides
  } as unknown as IAgentTaskRepository
}

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any
const worktree = { worktreePath: '/tmp/wt', branch: 'agent/task-1' }

describe('cleanupWorktreeWithRetry', () => {
  beforeEach(() => {
    vi.mocked(cleanupWorktree).mockReset()
    vi.mocked(sleep).mockClear()
  })

  it('succeeds on first attempt without retrying', async () => {
    vi.mocked(cleanupWorktree).mockResolvedValue(undefined)
    const repo = makeRepo()

    await cleanupWorktreeWithRetry('task-1', worktree, '/repo', repo, logger)

    expect(cleanupWorktree).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(repo.updateTask).not.toHaveBeenCalled()
  })

  it('retries after transient failures then succeeds', async () => {
    vi.mocked(cleanupWorktree)
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValue(undefined)
    const repo = makeRepo()

    await cleanupWorktreeWithRetry('task-1', worktree, '/repo', repo, logger)

    expect(cleanupWorktree).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(repo.updateTask).not.toHaveBeenCalled()
  })

  it('surfaces persistent failure to task notes after all retries exhausted', async () => {
    vi.mocked(cleanupWorktree).mockRejectedValue(new Error('Permission denied'))
    const repo = makeRepo()

    await cleanupWorktreeWithRetry('task-1', worktree, '/repo', repo, logger)

    // 4 total: 3 loop iterations (with sleep) + 1 final attempt
    expect(cleanupWorktree).toHaveBeenCalledTimes(4)
    expect(repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ notes: expect.stringContaining('Permission denied') })
    )
  })

  it('does not throw even when repo.updateTask fails', async () => {
    vi.mocked(cleanupWorktree).mockRejectedValue(new Error('fail'))
    const repo = makeRepo({
      updateTask: vi.fn().mockRejectedValue(new Error('write failed'))
    })

    await expect(
      cleanupWorktreeWithRetry('task-1', worktree, '/repo', repo, logger)
    ).resolves.toBeUndefined()
  })
})
