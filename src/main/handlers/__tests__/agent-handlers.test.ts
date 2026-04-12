/**
 * Agent handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock ipc-utils first
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock electron (for BrowserWindow used by broadcast)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { webContents: { send: vi.fn() } }
    ])
  }
}))

// Mock broadcast
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

// Mock webhook-service
vi.mock('../../services/webhook-service', () => ({
  createWebhookService: vi.fn(() => ({
    fireWebhook: vi.fn()
  })),
  getWebhookEventName: vi.fn((type, _task) => `sprint.task.${type}`)
}))

// Mock webhook-queries
vi.mock('../../data/webhook-queries', () => ({
  getWebhooks: vi.fn(() => [])
}))

// Mock logger
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

// Mock agent-log-manager
vi.mock('../../agent-log-manager', () => ({
  tailAgentLog: vi.fn(),
  cleanupOldLogs: vi.fn()
}))

// Mock agent-history
vi.mock('../../agent-history', () => ({
  listAgents: vi.fn(),
  readLog: vi.fn(),
  importAgent: vi.fn(),
  pruneOldAgents: vi.fn(),
  getAgentMeta: vi.fn()
}))

// Mock adhoc-agent
vi.mock('../../adhoc-agent', () => ({
  spawnAdhocAgent: vi.fn(),
  getAdhocHandle: vi.fn()
}))

// Mock sprint-queries (used by promoteToReview)
vi.mock('../../data/sprint-queries', () => ({
  createReviewTaskFromAdhoc: vi.fn(),
  getTask: vi.fn(),
  updateTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  getActiveTaskCount: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn(),
  UPDATE_ALLOWLIST: new Set(['title', 'status'])
}))

// Mock env-utils (used by promoteToReview to spawn git)
vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ HOME: '/tmp' }))
}))

// Mock node:fs existsSync used by promoteToReview to validate worktree path.
// Tests override this per-case via vi.mocked(existsSync).mockReturnValue(...)
// when they need to assert "worktree gone" behavior.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

// Mock data/event-queries (used lazily in agent:history)
vi.mock('../../data/event-queries', () => ({
  getEventHistory: vi.fn(),
  appendEvent: vi.fn()
}))

// Mock db (used lazily in agent:history)
vi.mock('../../db', () => ({
  getDb: vi.fn().mockReturnValue({})
}))

import { existsSync } from 'node:fs'
import { registerAgentHandlers } from '../agent-handlers'
import { safeHandle } from '../../ipc-utils'
import { cleanupOldLogs } from '../../agent-log-manager'
import { listAgents, readLog, pruneOldAgents, getAgentMeta } from '../../agent-history'
import { spawnAdhocAgent, getAdhocHandle } from '../../adhoc-agent'
import { getEventHistory } from '../../data/event-queries'
import { createReviewTaskFromAdhoc } from '../../data/sprint-queries'
import { nowIso } from '../../../shared/time'

const mockEvent = {} as IpcMainInvokeEvent

function captureHandler(channel: string, am?: any): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined

  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })

  registerAgentHandlers(am)

  if (!captured) throw new Error(`No handler captured for channel "${channel}"`)
  return captured
}

describe('registerAgentHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers expected channels', () => {
    registerAgentHandlers()
    const channels = vi.mocked(safeHandle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('local:getAgentProcesses')
    expect(channels).toContain('local:spawnClaudeAgent')
    expect(channels).toContain('local:tailAgentLog')
    expect(channels).toContain('agent:steer')
    expect(channels).toContain('agent:kill')
    expect(channels).toContain('agent:history')
    expect(channels).toContain('agents:list')
    expect(channels).toContain('agents:readLog')
    expect(channels).toContain('agents:import')
    expect(channels).toContain('agents:promoteToReview')
  })

  it('calls cleanupOldLogs and pruneOldAgents on registration', () => {
    registerAgentHandlers()
    expect(cleanupOldLogs).toHaveBeenCalled()
    expect(pruneOldAgents).toHaveBeenCalled()
  })
})

describe('agents:list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns list of agents', async () => {
    const agents = [
      { id: 'agent-1', status: 'done', task: 'Build feature' },
      { id: 'agent-2', status: 'active', task: 'Fix bug' }
    ]
    vi.mocked(listAgents).mockResolvedValue(agents as any)

    const handler = captureHandler('agents:list')
    const result = await handler(mockEvent, { limit: 10 })

    expect(listAgents).toHaveBeenCalledWith(10, undefined)
    expect(result).toEqual(agents)
  })

  it('filters by status when provided', async () => {
    const agents = [{ id: 'agent-3', status: 'active' }]
    vi.mocked(listAgents).mockResolvedValue(agents as any)

    const handler = captureHandler('agents:list')
    const result = await handler(mockEvent, { limit: 5, status: 'active' })

    expect(listAgents).toHaveBeenCalledWith(5, 'active')
    expect(result).toEqual(agents)
  })
})

describe('agents:readLog handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns log content from agent history', async () => {
    vi.mocked(readLog).mockResolvedValue({ content: 'log output', nextByte: 10, totalBytes: 10 })

    const handler = captureHandler('agents:readLog')
    const result = await handler(mockEvent, { id: 'agent-1', fromByte: 0 })

    expect(readLog).toHaveBeenCalledWith('agent-1', 0)
    expect(result).toEqual({ content: 'log output', nextByte: 10, totalBytes: 10 })
  })

  it('reads from offset when fromByte is provided', async () => {
    vi.mocked(readLog).mockResolvedValue({ content: 'new content', nextByte: 100, totalBytes: 100 })

    const handler = captureHandler('agents:readLog')
    await handler(mockEvent, { id: 'agent-1', fromByte: 50 })

    expect(readLog).toHaveBeenCalledWith('agent-1', 50)
  })
})

describe('agent:kill handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('kills via adhoc handle when available', async () => {
    const mockHandle = { close: vi.fn(), send: vi.fn() }
    vi.mocked(getAdhocHandle).mockReturnValue(mockHandle as any)

    const handler = captureHandler('agent:kill')
    const result = await handler(mockEvent, 'adhoc-agent-1')

    expect(mockHandle.close).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  it('kills via AgentManager when no adhoc handle', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)
    const mockAm = { killAgent: vi.fn() }

    const handler = captureHandler('agent:kill', mockAm)
    const result = await handler(mockEvent, 'managed-agent-1')

    expect(mockAm.killAgent).toHaveBeenCalledWith('managed-agent-1')
    expect(result).toEqual({ ok: true })
  })

  it('returns error when no adhoc or AgentManager', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)

    const handler = captureHandler('agent:kill')
    const result = await handler(mockEvent, 'runner-agent-1')

    expect(result).toEqual({ ok: false, error: 'Agent not found' })
  })
})

describe('agent:steer handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('steers via adhoc handle when available', async () => {
    const mockHandle = { send: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    vi.mocked(getAdhocHandle).mockReturnValue(mockHandle as any)

    const handler = captureHandler('agent:steer')
    const result = await handler(mockEvent, { agentId: 'adhoc-1', message: 'Do this' })

    expect(mockHandle.send).toHaveBeenCalledWith('Do this', undefined)
    expect(result).toEqual({ ok: true })
  })

  it('steers via AgentManager when no adhoc handle', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)
    const mockAm = { steerAgent: vi.fn().mockResolvedValue({ delivered: true }) }

    const handler = captureHandler('agent:steer', mockAm)
    const result = await handler(mockEvent, { agentId: 'managed-1', message: 'Pivot' })

    expect(mockAm.steerAgent).toHaveBeenCalledWith('managed-1', 'Pivot')
    expect(result).toEqual({ ok: true })
  })

  it('returns error when no adhoc or AgentManager', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)

    const handler = captureHandler('agent:steer')
    const result = await handler(mockEvent, { agentId: 'remote-1', message: 'Hello' })

    expect(result).toEqual({ ok: false, error: 'No agent manager available' })
  })
})

describe('agent:history handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed event history from SQLite', async () => {
    const rows = [
      { payload: JSON.stringify({ type: 'message', text: 'Hello' }) },
      { payload: JSON.stringify({ type: 'result', exitCode: 0 }) }
    ]
    vi.mocked(getEventHistory).mockReturnValue(rows as any)

    const handler = captureHandler('agent:history')
    const result = await handler(mockEvent, 'agent-42')

    expect(getEventHistory).toHaveBeenCalledWith({}, 'agent-42')
    expect(result).toEqual([
      { type: 'message', text: 'Hello' },
      { type: 'result', exitCode: 0 }
    ])
  })

  it('returns empty array when no events exist', async () => {
    vi.mocked(getEventHistory).mockReturnValue([])

    const handler = captureHandler('agent:history')
    const result = await handler(mockEvent, 'agent-empty')

    expect(result).toEqual([])
  })
})

describe('local:spawnClaudeAgent handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to spawnAdhocAgent with correct args', async () => {
    const spawnResult = { agentId: 'new-agent-1', ok: true }
    vi.mocked(spawnAdhocAgent).mockResolvedValue(spawnResult as any)

    const handler = captureHandler('local:spawnClaudeAgent')
    const result = await handler(mockEvent, {
      task: 'Build the feature',
      repoPath: '/Users/test/projects/BDE',
      model: 'claude-opus-4'
    })

    expect(spawnAdhocAgent).toHaveBeenCalledWith({
      task: 'Build the feature',
      repoPath: '/Users/test/projects/BDE',
      model: 'claude-opus-4',
      assistant: undefined
    })
    expect(result).toEqual(spawnResult)
  })
})

describe('agents:promoteToReview handler', () => {
  // Build a deterministic AgentMeta for an adhoc agent that has finished
  // with a worktree on disk and committed work — the canonical "ready to
  // promote" state.
  function makeAdhocAgent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'adhoc-1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '/Users/test/bde',
      task: 'Add clipboard image paste\n\nMore details follow.',
      startedAt: nowIso(),
      finishedAt: nowIso(),
      exitCode: 0,
      status: 'done',
      logPath: '/tmp/logs/adhoc-1/log.jsonl',
      source: 'adhoc',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null,
      worktreePath: '/tmp/bde-adhoc/bde/adhoc-1',
      branch: 'agent/add-clipboard-image-paste-adhoc-1',
      ...overrides
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: worktree directory exists. Tests that need it missing override.
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('returns error when agent is not found', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(null)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'missing-agent')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
    // Must NOT touch sprint_tasks when the agent doesn't exist
    expect(createReviewTaskFromAdhoc).not.toHaveBeenCalled()
  })

  it('returns error when agent has no worktree path', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent({ worktreePath: null }) as any)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'adhoc-1')

    expect(result.ok).toBe(false)
    // Legacy adhoc agents (spawned before the worktree change) should be
    // rejected with a clear message rather than silently producing an
    // unreviewable sprint task with no diff.
    expect(result.error).toMatch(/no worktree/i)
    expect(createReviewTaskFromAdhoc).not.toHaveBeenCalled()
  })

  it('returns error when worktree directory has been deleted', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent() as any)
    vi.mocked(existsSync).mockReturnValue(false)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'adhoc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer exists/i)
    expect(createReviewTaskFromAdhoc).not.toHaveBeenCalled()
  })

  it('returns error when agent has no branch recorded', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent({ branch: null }) as any)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'adhoc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no branch/i)
    expect(createReviewTaskFromAdhoc).not.toHaveBeenCalled()
  })

  it('creates a review sprint task on the happy path', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent() as any)
    vi.mocked(createReviewTaskFromAdhoc).mockReturnValue({
      id: 'task-42',
      status: 'review'
    } as any)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'adhoc-1')

    expect(result.ok).toBe(true)
    expect(result.taskId).toBe('task-42')
    // The new sprint task must carry the agent's worktree, branch, and the
    // full task message as the spec — that's what Code Review reads.
    expect(createReviewTaskFromAdhoc).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'bde',
        worktreePath: '/tmp/bde-adhoc/bde/adhoc-1',
        branch: 'agent/add-clipboard-image-paste-adhoc-1',
        spec: 'Add clipboard image paste\n\nMore details follow.'
      })
    )
    // Title is derived from the FIRST non-blank line of the task message.
    // Multi-line task messages must not produce a multi-line title.
    const call = vi.mocked(createReviewTaskFromAdhoc).mock.calls[0][0]
    expect(call.title).toBe('Add clipboard image paste')
  })

  it('caps title at 120 characters with ellipsis when first line is long', async () => {
    const longLine = 'x'.repeat(200)
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent({ task: longLine }) as any)
    vi.mocked(createReviewTaskFromAdhoc).mockReturnValue({ id: 'task-43' } as any)

    const handler = captureHandler('agents:promoteToReview')
    await handler(mockEvent, 'adhoc-1')

    const call = vi.mocked(createReviewTaskFromAdhoc).mock.calls[0][0]
    // 117 chars + '...' = 120 total — keeps the column width predictable
    // in the review queue list.
    expect(call.title.length).toBe(120)
    expect(call.title.endsWith('...')).toBe(true)
  })

  it('returns error when sprint task creation fails', async () => {
    vi.mocked(getAgentMeta).mockResolvedValue(makeAdhocAgent() as any)
    vi.mocked(createReviewTaskFromAdhoc).mockReturnValue(null)

    const handler = captureHandler('agents:promoteToReview')
    const result = await handler(mockEvent, 'adhoc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/failed to create/i)
    expect(result.taskId).toBeUndefined()
  })
})
