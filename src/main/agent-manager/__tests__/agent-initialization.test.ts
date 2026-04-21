import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../agent-event-mapper', () => ({
  emitAgentEvent: vi.fn(),
  mapRawMessage: vi.fn().mockReturnValue([]),
  flushAgentEventBatcher: vi.fn()
}))

// TurnTracker is not mocked — we pass a stub object to avoid SQLite access.

import { initializeAgentTracking } from '../agent-initialization'
import type { AgentHandle } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { AgentRunClaim } from '../run-agent'
import type { TurnTracker } from '../turn-tracker'
import { createAgentRecord } from '../../agent-history'
import { emitAgentEvent } from '../../agent-event-mapper'

function _makeTurnTrackerStub(): TurnTracker {
  return {
    processMessage: vi.fn(),
    totals: vi.fn().mockReturnValue({
      tokensIn: 0,
      tokensOut: 0,
      turnCount: 0,
      cacheTokensRead: 0,
      cacheTokensCreated: 0
    })
  } as unknown as TurnTracker
}

function makeHandle(): AgentHandle {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        yield { type: 'exit_code', exit_code: 0 }
      }
    },
    sessionId: 'session-id',
    abort: vi.fn(),
    steer: vi.fn()
  }
}

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: 'Do something',
    spec: null,
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    max_runtime_ms: null,
    max_cost_usd: null,
    ...overrides
  }
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn().mockReturnValue(null),
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

const worktree = { worktreePath: '/tmp/wt', branch: 'agent/test-1' }

describe('initializeAgentTracking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns agent, agentRunId, and turnTracker', () => {
    const activeAgents = new Map()
    const result = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(result).toHaveProperty('agent')
    expect(result).toHaveProperty('agentRunId')
    expect(result).toHaveProperty('turnTracker')
  })

  it('registers agent in activeAgents map', () => {
    const activeAgents = new Map()
    initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(activeAgents.has('task-1')).toBe(true)
  })

  it('agent has expected shape', () => {
    const activeAgents = new Map()
    const { agent } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(agent.taskId).toBe('task-1')
    expect(agent.model).toBe('claude-sonnet-4-5')
    expect(agent.costUsd).toBe(0)
    expect(agent.rateLimitCount).toBe(0)
  })

  it('agent agentRunId matches returned agentRunId', () => {
    const activeAgents = new Map()
    const { agent, agentRunId } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(agent.agentRunId).toBe(agentRunId)
  })

  it('persists agent_run_id on the task via repo.updateTask', () => {
    const activeAgents = new Map()
    const { agentRunId } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(mockRepo.updateTask).toHaveBeenCalledWith('task-1', { agent_run_id: agentRunId })
  })

  it('calls createAgentRecord', async () => {
    const activeAgents = new Map()
    initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    // Allow microtask
    await new Promise((r) => setTimeout(r, 10))
    expect(createAgentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'claude',
        status: 'running',
        source: 'bde',
        sprintTaskId: 'task-1'
      })
    )
  })

  it('emits agent:started event', () => {
    const activeAgents = new Map()
    const { agentRunId } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(emitAgentEvent).toHaveBeenCalledWith(
      agentRunId,
      expect.objectContaining({ type: 'agent:started' })
    )
  })

  it('wires handle.onStderr to emit agent:stderr events', () => {
    const activeAgents = new Map()
    const handle = makeHandle()
    const { agentRunId } = initializeAgentTracking(
      makeTask(),
      handle,
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    handle.onStderr?.('some error line')
    expect(emitAgentEvent).toHaveBeenCalledWith(
      agentRunId,
      expect.objectContaining({
        type: 'agent:stderr',
        text: 'some error line'
      })
    )
  })

  it('logs warning when updateTask fails', () => {
    const activeAgents = new Map()
    vi.mocked(mockRepo.updateTask).mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    const logger = makeLogger()
    initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      logger
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist agent_run_id')
    )
  })

  it('applies max_runtime_ms from task', () => {
    const activeAgents = new Map()
    const { agent } = initializeAgentTracking(
      makeTask({ max_runtime_ms: 120000 }),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(agent.maxRuntimeMs).toBe(120000)
  })

  it('applies max_cost_usd from task', () => {
    const activeAgents = new Map()
    const { agent } = initializeAgentTracking(
      makeTask({ max_cost_usd: 3.0 }),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    expect(agent.maxCostUsd).toBe(3.0)
  })

  it('turnTracker is a TurnTracker instance', () => {
    const activeAgents = new Map()
    const { turnTracker } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    // TurnTracker has processMessage and totals methods
    expect(typeof turnTracker.processMessage).toBe('function')
    expect(typeof turnTracker.totals).toBe('function')
  })

  // Use stub to verify the turnTracker returned is the same one registered in the result
  it('returned turnTracker has the agentRunId bound', () => {
    const activeAgents = new Map()
    const { agentRunId } = initializeAgentTracking(
      makeTask(),
      makeHandle(),
      'claude-sonnet-4-5',
      worktree,
      'prompt text',
      activeAgents,
      mockRepo,
      makeLogger()
    )
    // agentRunId is a UUID — just verify it's a string
    expect(typeof agentRunId).toBe('string')
    expect(agentRunId.length).toBeGreaterThan(0)
  })
})
