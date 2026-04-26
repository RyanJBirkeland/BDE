import { describe, it, expect } from 'vitest'
import { checkAgent } from '../watchdog'
import type { ActiveAgent, AgentManagerConfig } from '../types'
import { RATE_LIMIT_LOOP_THRESHOLD , DEFAULT_CONFIG} from '../types'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: DEFAULT_CONFIG.defaultModel
}

function makeAgent(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    taskId: 'task-1',
    agentRunId: 'run-1',
    handle: {
      messages: (async function* () {})(),
      sessionId: 'sess-1',
      abort: () => {},
      steer: async () => {}
    },
    model: DEFAULT_CONFIG.defaultModel,
    startedAt: 0,
    lastOutputAt: 0,
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

describe('checkAgent', () => {
  it('returns ok when all thresholds are within bounds', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0, rateLimitCount: 0 })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('ok')
  })

  it('returns max-runtime when elapsed time meets maxRuntimeMs', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0 })
    const now = baseConfig.maxRuntimeMs
    expect(checkAgent(agent, now, baseConfig)).toBe('max-runtime')
  })

  it('returns max-runtime when elapsed time exceeds maxRuntimeMs', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0 })
    const now = baseConfig.maxRuntimeMs + 1
    expect(checkAgent(agent, now, baseConfig)).toBe('max-runtime')
  })

  it('returns idle when time since last output meets idleTimeoutMs', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0 })
    // Not yet at maxRuntime, but idle
    const now = baseConfig.idleTimeoutMs
    expect(checkAgent(agent, now, baseConfig)).toBe('idle')
  })

  it('returns idle when time since last output exceeds idleTimeoutMs', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0 })
    const now = baseConfig.idleTimeoutMs + 1
    expect(checkAgent(agent, now, baseConfig)).toBe('idle')
  })

  it('returns rate-limit-loop when rateLimitCount meets threshold', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      rateLimitCount: RATE_LIMIT_LOOP_THRESHOLD
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('rate-limit-loop')
  })

  it('returns rate-limit-loop when rateLimitCount exceeds threshold', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      rateLimitCount: RATE_LIMIT_LOOP_THRESHOLD + 1
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('rate-limit-loop')
  })

  it('uses per-task maxRuntimeMs when set', () => {
    // Agent has a 120s per-task override — should be killed at 120s, not config's 3600s
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 120_000, maxRuntimeMs: 120_000 })
    const now = 120_000
    expect(checkAgent(agent, now, baseConfig)).toBe('max-runtime')
  })

  it('uses config default when maxRuntimeMs is null', () => {
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 120_000, maxRuntimeMs: null })
    // At 120s, should be ok since config default is 3600s
    const now = 120_000
    expect(checkAgent(agent, now, baseConfig)).toBe('ok')
  })

  it('max-runtime takes priority over idle', () => {
    // Both thresholds exceeded — max-runtime checked first
    const agent = makeAgent({ startedAt: 0, lastOutputAt: 0 })
    const now = baseConfig.maxRuntimeMs + baseConfig.idleTimeoutMs
    expect(checkAgent(agent, now, baseConfig)).toBe('max-runtime')
  })

  it('returns cost-budget-exceeded when costUsd meets maxCostUsd', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      costUsd: 5.0,
      maxCostUsd: 5.0
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('cost-budget-exceeded')
  })

  it('returns cost-budget-exceeded when costUsd exceeds maxCostUsd', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      costUsd: 5.5,
      maxCostUsd: 5.0
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('cost-budget-exceeded')
  })

  it('returns ok when costUsd is below maxCostUsd', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      costUsd: 4.5,
      maxCostUsd: 5.0
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('ok')
  })

  it('returns ok when maxCostUsd is null', () => {
    const agent = makeAgent({
      startedAt: 0,
      lastOutputAt: 0,
      costUsd: 100.0,
      maxCostUsd: null
    })
    const now = 1_000
    expect(checkAgent(agent, now, baseConfig)).toBe('ok')
  })
})
