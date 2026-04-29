/**
 * Tests for handleTaskTerminal in terminal-handler.ts.
 *
 * Covers:
 *   - Correct metrics recorded for done vs failed terminal status
 *   - Concurrent same-taskId calls share the in-flight promise, executing once
 *   - The in-flight map is cleared after resolution; a subsequent call executes independently
 *   - config.onStatusTerminal is called instead of resolveDependents when configured
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../../lib/resolve-dependents', () => ({
  resolveDependents: vi.fn()
}))

vi.mock('../settings', () => ({
  getSetting: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import { handleTaskTerminal, type TerminalHandlerDeps } from '../terminal-handler'
import { resolveDependents } from '../../lib/resolve-dependents'
import { makeLogger, makeMetrics } from './test-helpers'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { IUnitOfWork } from '../../data/unit-of-work'
import type { AgentManagerConfig, TerminalResolutionStrategy } from '../types'
import { createDependencyIndex } from '../../services/dependency-service'
import { createEpicDependencyIndex } from '../../services/epic-dependency-service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue(null),
    updateTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getOrphanedTasks: vi.fn().mockReturnValue([]),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: vi.fn().mockResolvedValue(null),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([]),
    getQueueStats: vi.fn().mockReturnValue({ queued: 0, active: 0 })
  } as unknown as IAgentTaskRepository
}

function makeUnitOfWork(): IUnitOfWork {
  return {
    runInTransaction: vi.fn((fn: () => void) => fn())
  } as unknown as IUnitOfWork
}

function makeConfig(overrides: Partial<AgentManagerConfig> = {}): AgentManagerConfig {
  return {
    maxConcurrent: 2,
    worktreeBase: '/tmp/worktrees',
    maxRuntimeMs: 3_600_000,
    idleTimeoutMs: 900_000,
    pollIntervalMs: 30_000,
    defaultModel: 'claude-sonnet-4-5',
    ...overrides
  }
}

function makeTerminalHandlerDeps(overrides: Partial<TerminalHandlerDeps> = {}): TerminalHandlerDeps {
  return {
    metrics: makeMetrics(),
    depIndex: createDependencyIndex(),
    epicIndex: createEpicDependencyIndex(),
    repo: makeRepo(),
    unitOfWork: makeUnitOfWork(),
    config: makeConfig(),
    terminalCalled: new Map(),
    logger: makeLogger(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Metrics tests
// ---------------------------------------------------------------------------

describe('handleTaskTerminal — metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('increments agentsCompleted when status is done', async () => {
    const deps = makeTerminalHandlerDeps()
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    await handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)

    expect(deps.metrics.increment).toHaveBeenCalledWith('agentsCompleted')
  })

  it('increments agentsFailed when status is failed', async () => {
    const deps = makeTerminalHandlerDeps()
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    await handleTaskTerminal('task-1', 'failed', onTaskTerminal, deps)

    expect(deps.metrics.increment).toHaveBeenCalledWith('agentsFailed')
  })
})

// ---------------------------------------------------------------------------
// Deduplication tests
// ---------------------------------------------------------------------------

describe('handleTaskTerminal — deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('concurrent calls for the same taskId execute the underlying work exactly once', async () => {
    let executionCount = 0

    // Use resolveDependents (async path) to control execution timing.
    // resolveDependents is called via resolveTerminalDependents which is awaited,
    // so we can create a genuine async hang by returning a never-resolving promise
    // and resolving it manually.
    vi.mocked(resolveDependents).mockImplementation(() => {
      executionCount++
    })

    // We need an async hang — route through resolveDependents by NOT setting onStatusTerminal.
    // But resolveDependents is synchronous in the mock. We need a truly async execution.
    // Instead, override the inner repo.updateTask to create the hang needed for the Map check.
    // Actually the simplest approach: issue p2 synchronously BEFORE awaiting, so it hits
    // the in-flight check before the map entry is cleared.

    // The key insight: handleTaskTerminal sets the map entry BEFORE awaiting,
    // so if we issue p2 synchronously right after p1 starts (without yielding),
    // p2 will see the in-flight entry.
    const deps = makeTerminalHandlerDeps()
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    // Issue both calls synchronously — p1 sets the map entry, p2 sees it
    const p1 = handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)
    const p2 = handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)

    await Promise.all([p1, p2])

    // Underlying execution fired exactly once — resolveDependents called once
    expect(executionCount).toBe(1)

    // The warn log confirms deduplication occurred
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate')
    )
  })

  it('clears the in-flight entry after resolution so a subsequent call fires a new execution', async () => {
    let executionCount = 0
    const terminalResolution: TerminalResolutionStrategy = {
      onStatusTerminal: () => { executionCount++ }
    }
    const deps = makeTerminalHandlerDeps({ terminalResolution })
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    // First call completes
    await handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)
    expect(executionCount).toBe(1)

    // After resolution the map should be empty
    expect(deps.terminalCalled.size).toBe(0)

    // Second call should fire a new execution
    await handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)
    expect(executionCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// onStatusTerminal routing
// ---------------------------------------------------------------------------

describe('handleTaskTerminal — onStatusTerminal routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls terminalResolution.onStatusTerminal with taskId and status when configured', async () => {
    const onStatusTerminal = vi.fn()
    const terminalResolution: TerminalResolutionStrategy = { onStatusTerminal }
    const deps = makeTerminalHandlerDeps({ terminalResolution })
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    await handleTaskTerminal('task-1', 'done', onTaskTerminal, deps)

    expect(onStatusTerminal).toHaveBeenCalledOnce()
    expect(onStatusTerminal).toHaveBeenCalledWith('task-1', 'done')
    expect(resolveDependents).not.toHaveBeenCalled()
  })
})
