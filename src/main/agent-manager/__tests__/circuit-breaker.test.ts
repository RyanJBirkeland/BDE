/**
 * Circuit breaker tests (PHASE3-3.4).
 *
 * After N consecutive spawn failures the agent manager should pause the
 * drain loop for M minutes and emit a `circuit-breaker-open` event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/sprint-queries', () => ({
  getQueuedTasks: vi.fn(),
  claimTask: vi.fn().mockResolvedValue(null),
  updateTask: vi.fn().mockResolvedValue(null),
  forceUpdateTask: vi.fn(),
  getTask: vi.fn(),
  getOrphanedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  setSprintQueriesLogger: vi.fn()
}))

// broadcast is now injected via CircuitBreaker constructor — no module-level mock needed
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({}),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log'
}))

import { AgentManagerImpl } from '../index'
import { CircuitBreaker, SPAWN_CIRCUIT_FAILURE_THRESHOLD, SPAWN_CIRCUIT_PAUSE_MS, type CircuitObserver } from '../circuit-breaker'
import type { AgentManagerConfig } from '../types'
import { DEFAULT_CONFIG } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import { broadcast } from '../../broadcast'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 3,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 600_000,
  defaultModel: DEFAULT_CONFIG.defaultModel
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
}

function makeRepo(): IAgentTaskRepository {
  return {
    getTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getOrphanedTasks: vi.fn().mockReturnValue([]),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: vi.fn().mockResolvedValue(null),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([])
  }
}

describe('spawn failure circuit breaker (PHASE3-3.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not open the breaker before reaching the threshold', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    expect(mgr.__testInternals.circuitBreaker.isOpen()).toBe(false)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('opens the breaker exactly at the threshold and emits an event', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    expect(mgr.__testInternals.circuitBreaker.isOpen()).toBe(true)
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
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    mgr.__testInternals.circuitBreaker.recordSuccess()
    expect(mgr.__testInternals.circuitBreaker.failureCount).toBe(0)

    // Now we can fail threshold-1 more times without opening
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    expect(mgr.__testInternals.circuitBreaker.isOpen()).toBe(false)
  })

  it('auto-resets after the pause window elapses', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    expect(mgr.__testInternals.circuitBreaker.isOpen()).toBe(true)

    // Pretend pause window has fully elapsed
    const future = mgr.__testInternals.circuitBreaker.openUntilTimestamp + SPAWN_CIRCUIT_PAUSE_MS + 1
    expect(mgr.__testInternals.circuitBreaker.isOpen(future)).toBe(false)
    expect(mgr.__testInternals.circuitBreaker.failureCount).toBe(0)
  })

  it('logs failure count and open duration when auto-resetting', () => {
    const logger = makeLogger()
    const breaker = new CircuitBreaker(logger)
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure('task-x', 'spawn error')
    }
    expect(breaker.isOpen()).toBe(true)

    const future = breaker.openUntilTimestamp + 1
    breaker.isOpen(future)

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/Pause elapsed — resuming drain \(was open for \d+ms after \d+ consecutive failures\)/)
    )
  })

  it('drain loop is skipped while breaker is open', async () => {
    const repo = makeRepo()
    const mgr = new AgentManagerImpl(baseConfig, repo, makeLogger())
    // Trip the breaker
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }

    await mgr.__testInternals.drainLoop()

    // No queued-task fetch should happen while paused
    expect(repo.getQueuedTasks).not.toHaveBeenCalled()
  })

  it('only opens once per trip — repeated failures during pause do not re-broadcast', () => {
    const mgr = new AgentManagerImpl(baseConfig, makeRepo(), makeLogger())
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      mgr.__testInternals.circuitBreaker.recordFailure()
    }
    expect(broadcast).toHaveBeenCalledTimes(1)

    // Additional failures while open should not re-emit
    mgr.__testInternals.circuitBreaker.recordFailure()
    mgr.__testInternals.circuitBreaker.recordFailure()
    expect(broadcast).toHaveBeenCalledTimes(1)
  })
})

describe('spawn-phase circuit breaker scope (EP-5 T-55)', () => {
  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('increments when recordFailure is called (spawn-phase failure)', () => {
    const breaker = new CircuitBreaker(makeLogger())
    breaker.recordFailure('task-1', 'spawn failed')
    expect(breaker.failureCount).toBe(1)
  })

  it('includes taskId and reason in structured event when circuit opens', () => {
    const logger = makeLogger()
    const breaker = new CircuitBreaker(logger)
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      breaker.recordFailure('task-prev', 'spawn error')
    }
    breaker.recordFailure('task-trigger', 'enoent: node not found')
    expect(logger.event).toHaveBeenCalledWith(
      'circuit-breaker.open',
      expect.objectContaining({
        triggeringTask: 'task-trigger',
        failureCount: SPAWN_CIRCUIT_FAILURE_THRESHOLD,
        recentFailures: expect.arrayContaining([
          expect.objectContaining({ taskId: 'task-trigger', reason: 'enoent: node not found' })
        ])
      })
    )
  })

  it('resets recentFailures on recordSuccess', () => {
    const logger = makeLogger()
    const breaker = new CircuitBreaker(logger)
    breaker.recordFailure('task-1', 'error')
    breaker.recordSuccess()
    // After success, failure list is cleared so a fresh trip logs only new failures
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure('task-2', 'new error')
    }
    expect(logger.event).toHaveBeenCalledWith(
      'circuit-breaker.open',
      expect.objectContaining({
        recentFailures: expect.not.arrayContaining([
          expect.objectContaining({ taskId: 'task-1' })
        ])
      })
    )
  })

  it('calls injected CircuitObserver.onCircuitOpen when breaker trips', () => {
    const logger = makeLogger()
    const onCircuitOpen = vi.fn()
    const observer: CircuitObserver = { onCircuitOpen }
    const breaker = new CircuitBreaker(logger, observer)
    for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure('task-x', 'spawn error')
    }
    expect(onCircuitOpen).toHaveBeenCalledTimes(1)
    expect(onCircuitOpen).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: SPAWN_CIRCUIT_FAILURE_THRESHOLD })
    )
  })

  it('does not throw when observer is absent', () => {
    const logger = makeLogger()
    const breaker = new CircuitBreaker(logger)
    expect(() => {
      for (let i = 0; i < SPAWN_CIRCUIT_FAILURE_THRESHOLD; i++) {
        breaker.recordFailure('task-x', 'spawn error')
      }
    }).not.toThrow()
  })
})
