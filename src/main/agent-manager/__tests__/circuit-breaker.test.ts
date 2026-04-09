/**
 * Circuit breaker tests (PHASE3-3.4).
 *
 * After N consecutive spawn failures the agent manager should pause the
 * drain loop for M minutes and emit a `circuit-breaker-open` event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/sprint-queries', () => ({
  getQueuedTasks: vi.fn(),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  getOrphanedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  setSprintQueriesLogger: vi.fn()
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({}),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log'
}))

import { AgentManagerImpl, SPAWN_CIRCUIT_FAILURE_THRESHOLD, SPAWN_CIRCUIT_PAUSE_MS } from '../index'
import type { AgentManagerConfig } from '../types'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import { broadcast } from '../../broadcast'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 3,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 600_000,
  defaultModel: 'claude-sonnet-4-5'
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeRepo(): ISprintTaskRepository {
  return {
    getTask: vi.fn(),
    updateTask: vi.fn(),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getOrphanedTasks: vi.fn().mockReturnValue([]),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: vi.fn()
  }
}

describe('spawn failure circuit breaker (PHASE3-3.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not open the breaker before reaching the threshold', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      mgr._recordSpawnFailure()
    }
    expect(mgr._isCircuitOpen()).toBe(false)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('opens the breaker exactly at the threshold and emits an event', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr._recordSpawnFailure()
    }
    expect(mgr._isCircuitOpen()).toBe(true)
    expect(broadcast).toHaveBeenCalledWith(
      'agent-manager:circuit-breaker-open',
      expect.objectContaining({
        consecutiveFailures: SPAWN_CIRCUIT_FAILURE_THRESHOLD
      })
    )
  })

  it('a successful spawn resets the failure counter', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      mgr._recordSpawnFailure()
    }
    mgr._recordSpawnSuccess()
    expect(mgr._consecutiveSpawnFailures).toBe(0)

    // Now we can fail threshold-1 more times without opening
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      mgr._recordSpawnFailure()
    }
    expect(mgr._isCircuitOpen()).toBe(false)
  })

  it('auto-resets after the pause window elapses', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr._recordSpawnFailure()
    }
    expect(mgr._isCircuitOpen()).toBe(true)

    // Pretend pause window has fully elapsed
    const future = mgr._circuitOpenUntil + SPAWN_CIRCUIT_PAUSE_MS + 1
    expect(mgr._isCircuitOpen(future)).toBe(false)
    expect(mgr._consecutiveSpawnFailures).toBe(0)
  })

  it('drain loop is skipped while breaker is open', async () => {
    const repo = makeRepo()
    const mgr = new AgentManagerImpl(baseConfig, repo, makeLogger())
    // Trip the breaker
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr._recordSpawnFailure()
    }

    await mgr._drainLoop()

    // No queued-task fetch should happen while paused
    expect(repo.getQueuedTasks).not.toHaveBeenCalled()
  })

  it('only opens once per trip — repeated failures during pause do not re-broadcast', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr._recordSpawnFailure()
    }
    expect(broadcast).toHaveBeenCalledTimes(1)

    // Additional failures while open should not re-emit
    mgr._recordSpawnFailure()
    mgr._recordSpawnFailure()
    expect(broadcast).toHaveBeenCalledTimes(1)
  })
})
