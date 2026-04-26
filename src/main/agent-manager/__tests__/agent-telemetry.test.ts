import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../agent-history', () => ({
  updateAgentMeta: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../data/agent-queries', () => ({
  updateAgentRunCost: vi.fn()
}))

vi.mock('../../db', () => ({
  getDb: vi.fn().mockReturnValue({})
}))

// Avoid mocking TurnTracker as a class — use a plain stub object instead.
// The TurnTracker constructor accesses getDb() which requires real SQLite;
// a stub bypasses that entirely without needing to mock TurnTracker itself.

import { trackAgentCosts, persistAgentRunTelemetry, computeTokenCost } from '../agent-telemetry'
import type { ActiveAgent, AgentHandle } from '../types'
import { DEFAULT_CONFIG } from '../types'
import type { TurnTracker } from '../turn-tracker'
import { updateAgentMeta } from '../../agent-history'
import { updateAgentRunCost } from '../../data/agent-queries'

function makeTurnTracker(
  overrides: Partial<Pick<TurnTracker, 'processMessage' | 'totals'>> = {}
): TurnTracker {
  return {
    processMessage: vi.fn(),
    totals: vi.fn().mockReturnValue({
      tokensIn: 100,
      tokensOut: 50,
      turnCount: 3,
      cacheTokensRead: 10,
      cacheTokensCreated: 5
    }),
    ...overrides
  } as unknown as TurnTracker
}

function makeAgent(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    taskId: 'task-1',
    agentRunId: 'run-1',
    handle: null as unknown as AgentHandle,
    model: 'sonnet',
    startedAt: Date.now() - 5000,
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: null,
    maxCostUsd: null,
    worktreePath: '/tmp/worktrees/task-1',
    branch: 'agent/task-1',
    ...overrides
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

describe('trackAgentCosts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates costUsd from cost_usd field', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    trackAgentCosts({ cost_usd: 0.05 }, agent, turnTracker)
    expect(agent.costUsd).toBe(0.05)
  })

  it('updates costUsd from total_cost_usd when cost_usd absent', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    trackAgentCosts({ total_cost_usd: 0.1 }, agent, turnTracker)
    expect(agent.costUsd).toBe(0.1)
  })

  it('prefers cost_usd over total_cost_usd', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    trackAgentCosts({ cost_usd: 0.05, total_cost_usd: 0.1 }, agent, turnTracker)
    expect(agent.costUsd).toBe(0.05)
  })

  it('keeps existing costUsd when neither field present', () => {
    const agent = makeAgent({ costUsd: 0.03 })
    const turnTracker = makeTurnTracker()
    trackAgentCosts({ type: 'assistant' }, agent, turnTracker)
    expect(agent.costUsd).toBe(0.03)
  })

  it('updates tokensIn and tokensOut from TurnTracker', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    trackAgentCosts({}, agent, turnTracker)
    expect(agent.tokensIn).toBe(100)
    expect(agent.tokensOut).toBe(50)
  })

  it('calls turnTracker.processMessage', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    const msg = { type: 'assistant' }
    trackAgentCosts(msg, agent, turnTracker)
    expect(turnTracker.processMessage).toHaveBeenCalledWith(msg)
  })
})

describe('persistAgentRunTelemetry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls updateAgentMeta with done status on exitCode 0', () => {
    const agent = makeAgent({ costUsd: 1.5, tokensIn: 200, tokensOut: 100 })
    const turnTracker = makeTurnTracker()
    const exitedAt = Date.now()
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, exitedAt, 5000, makeLogger())
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'done', exitCode: 0 })
    )
  })

  it('calls updateAgentMeta with failed status on non-zero exitCode', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    const exitedAt = Date.now()
    persistAgentRunTelemetry('run-1', agent, 1, turnTracker, exitedAt, 5000, makeLogger())
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('calls updateAgentMeta with failed status on undefined exitCode', () => {
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    const exitedAt = Date.now()
    persistAgentRunTelemetry('run-1', agent, undefined, turnTracker, exitedAt, 5000, makeLogger())
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', exitCode: null })
    )
  })

  it('calls updateAgentRunCost with telemetry data', () => {
    const agent = makeAgent({ costUsd: 2.0, tokensIn: 100, tokensOut: 50 })
    const turnTracker = makeTurnTracker()
    const exitedAt = Date.now()
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, exitedAt, 10000, makeLogger())
    expect(updateAgentRunCost).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({
        costUsd: 2.0,
        durationMs: 10000,
        numTurns: 3
      })
    )
  })

  it('logs warning when updateAgentMeta rejects', async () => {
    vi.mocked(updateAgentMeta).mockRejectedValueOnce(new Error('DB down'))
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    const logger = makeLogger()
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, Date.now(), 5000, logger)
    // Allow microtask to run
    await new Promise((r) => setTimeout(r, 10))
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update agent record')
    )
  })

  it('logs warning when updateAgentRunCost throws', () => {
    vi.mocked(updateAgentRunCost).mockImplementationOnce(() => {
      throw new Error('SQLite error')
    })
    const agent = makeAgent()
    const turnTracker = makeTurnTracker()
    const logger = makeLogger()
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, Date.now(), 5000, logger)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist cost breakdown')
    )
  })

  it('falls back to token-derived cost when SDK result message was never received', () => {
    // Simulates the common case: pipeline agent exits before the SDK subprocess
    // yields the result message (e.g. maxTurns abort or process signal), so
    // agent.costUsd stays at 0. The fallback should compute from token totals.
    const agent = makeAgent({
      costUsd: 0,
      model: DEFAULT_CONFIG.defaultModel
    })
    const turnTracker = makeTurnTracker({
      totals: vi.fn().mockReturnValue({
        tokensIn: 180,
        tokensOut: 39,
        turnCount: 14,
        cacheTokensRead: 366162,
        cacheTokensCreated: 116822
      })
    })
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, Date.now(), 5000, makeLogger())

    const costArg = vi.mocked(updateAgentRunCost).mock.calls[0]?.[2]
    expect(costArg).toBeDefined()
    expect(costArg!.costUsd).toBeGreaterThan(0)
  })

  it('keeps agent.costUsd when it was populated from the SDK result message', () => {
    const agent = makeAgent({ costUsd: 0.15, model: DEFAULT_CONFIG.defaultModel })
    const turnTracker = makeTurnTracker({
      totals: vi.fn().mockReturnValue({
        tokensIn: 180,
        tokensOut: 39,
        turnCount: 14,
        cacheTokensRead: 366162,
        cacheTokensCreated: 116822
      })
    })
    persistAgentRunTelemetry('run-1', agent, 0, turnTracker, Date.now(), 5000, makeLogger())

    const costArg = vi.mocked(updateAgentRunCost).mock.calls[0]?.[2]
    expect(costArg!.costUsd).toBe(0.15)
  })
})

describe('computeTokenCost', () => {
  it('returns 0 for an unrecognized model', () => {
    expect(computeTokenCost('unknown-model-xyz', 1000, 500, 0, 0)).toBe(0)
  })

  it('computes non-zero cost for a known Sonnet 4.5 model with cache reads', () => {
    const cost = computeTokenCost(DEFAULT_CONFIG.defaultModel, 180, 39, 366162, 116822)
    expect(cost).toBeGreaterThan(0)
  })

  it('computes cost proportional to cache reads for Sonnet 4.5', () => {
    const noCacheCost = computeTokenCost(DEFAULT_CONFIG.defaultModel, 100, 50, 0, 0)
    const withCacheCost = computeTokenCost(DEFAULT_CONFIG.defaultModel, 100, 50, 1_000_000, 0)
    expect(withCacheCost).toBeGreaterThan(noCacheCost)
  })

  it('matches haiku pricing for haiku-4-5 model', () => {
    const haikuCost = computeTokenCost('claude-haiku-4-5', 1_000_000, 0, 0, 0)
    const sonnetCost = computeTokenCost(DEFAULT_CONFIG.defaultModel, 1_000_000, 0, 0, 0)
    expect(haikuCost).toBeLessThan(sonnetCost)
  })
})
