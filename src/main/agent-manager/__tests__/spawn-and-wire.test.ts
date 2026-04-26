import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../sdk-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sdk-adapter')>()
  return {
    ...actual,
    spawnWithTimeout: vi.fn()
  }
})

vi.mock('../agent-initialization', () => ({
  initializeAgentTracking: vi.fn()
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../agent-event-mapper', () => ({
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('../../services/credential-service', () => ({
  getDefaultCredentialService: vi.fn(() => ({
    getCredential: vi.fn().mockResolvedValue({
      kind: 'claude',
      status: 'ok',
      token: 'test',
      expiresAt: null,
      cliFound: true
    }),
    refreshCredential: vi.fn().mockResolvedValue({
      kind: 'claude',
      status: 'ok',
      token: 'test',
      expiresAt: null,
      cliFound: true
    }),
    invalidateCache: vi.fn()
  }))
}))

import { spawnAndWireAgent, handleSpawnFailure } from '../spawn-and-wire'
import { spawnWithTimeout } from '../sdk-adapter'
import { initializeAgentTracking } from '../agent-initialization'
import { emitAgentEvent } from '../../agent-event-mapper'
import { cleanupWorktree } from '../worktree'
import type { RunAgentDeps, AgentRunClaim } from '../run-agent'
import type { ActiveAgent, AgentHandle } from '../types'
import { DEFAULT_CONFIG } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-1',
    title: 'Test',
    prompt: 'Do it',
    spec: null,
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    max_cost_usd: null,
    ...overrides
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeDeps(overrides: Partial<RunAgentDeps> = {}): RunAgentDeps {
  return {
    activeAgents: new Map(),
    defaultModel: DEFAULT_CONFIG.defaultModel,
    logger: makeLogger(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    metrics: { increment: vi.fn(), recordWatchdogVerdict: vi.fn(), setLastDrainDuration: vi.fn(), recordAgentDuration: vi.fn(), snapshot: vi.fn().mockReturnValue({}), reset: vi.fn() },
    ...overrides
  }
}

const worktree = { worktreePath: '/tmp/wt', branch: 'agent/test-1' }
const repoPath = '/repo'

function makeHandle(): AgentHandle {
  return {
    messages: { async *[Symbol.asyncIterator]() {} },
    sessionId: 'session-1',
    abort: vi.fn(),
    steer: vi.fn()
  }
}

const mockAgent: ActiveAgent = {
  taskId: 'task-1',
  agentRunId: 'run-1',
  handle: null as unknown as AgentHandle,
  model: 'sonnet',
  startedAt: Date.now(),
  lastOutputAt: Date.now(),
  rateLimitCount: 0,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  maxRuntimeMs: null,
  maxCostUsd: null,
  worktreePath: '/tmp/wt',
  branch: 'agent/test-1'
}

describe('spawnAndWireAgent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns agent tracking on successful spawn', async () => {
    vi.mocked(spawnWithTimeout).mockResolvedValue(makeHandle())
    vi.mocked(initializeAgentTracking).mockReturnValue({
      agent: mockAgent,
      agentRunId: 'run-1',
      turnTracker: {
        processMessage: vi.fn(),
        totals: vi.fn()
      } as unknown as import('../turn-tracker').TurnTracker
    })

    const deps = makeDeps()
    const result = await spawnAndWireAgent(makeTask(), 'prompt', worktree, repoPath, 'sonnet', deps)
    expect(result).toHaveProperty('agent')
    expect(result).toHaveProperty('agentRunId')
    expect(result).toHaveProperty('turnTracker')
  })

  it('calls onSpawnSuccess after successful spawn', async () => {
    vi.mocked(spawnWithTimeout).mockResolvedValue(makeHandle())
    vi.mocked(initializeAgentTracking).mockReturnValue({
      agent: mockAgent,
      agentRunId: 'run-1',
      turnTracker: {
        processMessage: vi.fn(),
        totals: vi.fn()
      } as unknown as import('../turn-tracker').TurnTracker
    })

    const onSpawnSuccess = vi.fn()
    const deps = makeDeps({ onSpawnSuccess })
    await spawnAndWireAgent(makeTask(), 'prompt', worktree, repoPath, 'sonnet', deps)
    expect(onSpawnSuccess).toHaveBeenCalled()
  })

  it('throws and marks error when spawn fails', async () => {
    vi.mocked(spawnWithTimeout).mockRejectedValue(new Error('Spawn failed'))
    const deps = makeDeps()
    await expect(
      spawnAndWireAgent(makeTask(), 'prompt', worktree, repoPath, 'sonnet', deps)
    ).rejects.toThrow('Spawn failed')
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
  })

  it('calls onTaskTerminal when spawn fails', async () => {
    vi.mocked(spawnWithTimeout).mockRejectedValue(new Error('Timeout'))
    const deps = makeDeps()
    await expect(
      spawnAndWireAgent(makeTask(), 'prompt', worktree, repoPath, 'sonnet', deps)
    ).rejects.toThrow()
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('calls onSpawnFailure with taskId and reason when spawn fails', async () => {
    vi.mocked(spawnWithTimeout).mockRejectedValue(new Error('Timeout'))
    const onSpawnFailure = vi.fn()
    const deps = makeDeps({ onSpawnFailure })
    await expect(
      spawnAndWireAgent(makeTask(), 'prompt', worktree, repoPath, 'sonnet', deps)
    ).rejects.toThrow()
    expect(onSpawnFailure).toHaveBeenCalledWith('task-1', expect.stringContaining('Timeout'))
  })
})

describe('handleSpawnFailure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits agent:error event', async () => {
    const deps = makeDeps()
    const err = new Error('Binary not found')
    await expect(handleSpawnFailure(err, makeTask(), worktree, repoPath, deps)).rejects.toThrow(
      'Binary not found'
    )
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        type: 'agent:error',
        message: expect.stringContaining('Spawn failed:')
      })
    )
  })

  it('calls cleanupWorktree', async () => {
    const deps = makeDeps()
    await expect(
      handleSpawnFailure(new Error('err'), makeTask(), worktree, repoPath, deps)
    ).rejects.toThrow()
    expect(cleanupWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch
      })
    )
  })

  it('logs warning when onSpawnFailure hook throws', async () => {
    const logger = makeLogger()
    const deps = makeDeps({
      logger,
      onSpawnFailure: () => {
        throw new Error('hook error')
      }
    })
    await expect(
      handleSpawnFailure(new Error('spawn err'), makeTask(), worktree, repoPath, deps)
    ).rejects.toThrow('spawn err')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('onSpawnFailure hook threw'))
  })

  it('re-throws the original error', async () => {
    const deps = makeDeps()
    const originalErr = new Error('Original spawn error')
    await expect(
      handleSpawnFailure(originalErr, makeTask(), worktree, repoPath, deps)
    ).rejects.toBe(originalErr)
  })
})
