import { describe, it, expect, vi } from 'vitest'
import { SpawnRegistry } from '../spawn-registry'
import type { ActiveAgent } from '../types'

function makeAgent(taskId: string): ActiveAgent {
  return {
    taskId,
    agentRunId: `run-${taskId}`,
    handle: {
      messages: (async function* () {})(),
      sessionId: `session-${taskId}`,
      abort: vi.fn(),
      steer: vi.fn().mockResolvedValue({ delivered: true })
    } as ActiveAgent['handle'],
    model: 'claude-3-5-sonnet-20241022',
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: null,
    maxCostUsd: null,
    worktreePath: `/tmp/worktrees/${taskId}`,
    branch: `agent/${taskId}`
  }
}

describe('SpawnRegistry — active agent verbs', () => {
  it('registers and retrieves an agent', () => {
    const registry = new SpawnRegistry()
    const agent = makeAgent('task-1')

    registry.registerAgent(agent)

    expect(registry.hasActiveAgent('task-1')).toBe(true)
    expect(registry.getAgent('task-1')).toBe(agent)
    expect(registry.activeAgentCount()).toBe(1)
  })

  it('removes an agent', () => {
    const registry = new SpawnRegistry()
    const agent = makeAgent('task-1')
    registry.registerAgent(agent)

    registry.removeAgent('task-1')

    expect(registry.hasActiveAgent('task-1')).toBe(false)
    expect(registry.getAgent('task-1')).toBeUndefined()
    expect(registry.activeAgentCount()).toBe(0)
  })

  it('returns undefined for unknown agent', () => {
    const registry = new SpawnRegistry()
    expect(registry.getAgent('unknown')).toBeUndefined()
    expect(registry.hasActiveAgent('unknown')).toBe(false)
  })

  it('allAgents() iterates all registered agents', () => {
    const registry = new SpawnRegistry()
    const agentA = makeAgent('task-a')
    const agentB = makeAgent('task-b')
    registry.registerAgent(agentA)
    registry.registerAgent(agentB)

    const agents = [...registry.allAgents()]

    expect(agents).toHaveLength(2)
    expect(agents).toContain(agentA)
    expect(agents).toContain(agentB)
  })

  it('allAgents() is empty on fresh registry', () => {
    const registry = new SpawnRegistry()
    expect([...registry.allAgents()]).toHaveLength(0)
  })
})

describe('SpawnRegistry — processing-task guard verbs', () => {
  it('marks and unmarks a task as processing', () => {
    const registry = new SpawnRegistry()

    registry.markProcessing('task-1')
    expect(registry.isProcessing('task-1')).toBe(true)

    registry.unmarkProcessing('task-1')
    expect(registry.isProcessing('task-1')).toBe(false)
  })

  it('returns false for tasks never marked', () => {
    const registry = new SpawnRegistry()
    expect(registry.isProcessing('never-seen')).toBe(false)
  })

  it('tracks two independent tasks independently', () => {
    const registry = new SpawnRegistry()
    registry.markProcessing('task-a')

    expect(registry.isProcessing('task-a')).toBe(true)
    expect(registry.isProcessing('task-b')).toBe(false)
  })
})

describe('SpawnRegistry — agent promise verbs', () => {
  it('tracks and forgets promises', () => {
    const registry = new SpawnRegistry()
    const promise = Promise.resolve()

    registry.trackPromise(promise)
    expect([...registry.allPromises()]).toContain(promise)

    registry.forgetPromise(promise)
    expect([...registry.allPromises()]).not.toContain(promise)
  })

  it('allPromises() is empty on fresh registry', () => {
    const registry = new SpawnRegistry()
    expect([...registry.allPromises()]).toHaveLength(0)
  })

  it('tracks multiple promises independently', () => {
    const registry = new SpawnRegistry()
    const p1 = Promise.resolve()
    const p2 = Promise.resolve()
    registry.trackPromise(p1)
    registry.trackPromise(p2)

    expect([...registry.allPromises()]).toHaveLength(2)

    registry.forgetPromise(p1)
    expect([...registry.allPromises()]).toHaveLength(1)
    expect([...registry.allPromises()]).toContain(p2)
  })
})

describe('SpawnRegistry — pending-spawn counter verbs', () => {
  it('starts at 0', () => {
    const registry = new SpawnRegistry()
    expect(registry.pendingSpawnCount()).toBe(0)
  })

  it('increments and decrements', () => {
    const registry = new SpawnRegistry()
    registry.incrementPendingSpawns()
    registry.incrementPendingSpawns()
    expect(registry.pendingSpawnCount()).toBe(2)

    registry.decrementPendingSpawns()
    expect(registry.pendingSpawnCount()).toBe(1)
  })

  it('floors at 0 — never goes negative', () => {
    const registry = new SpawnRegistry()
    registry.decrementPendingSpawns()
    registry.decrementPendingSpawns()
    expect(registry.pendingSpawnCount()).toBe(0)
  })

  it('decrement after increment floors safely', () => {
    const registry = new SpawnRegistry()
    registry.incrementPendingSpawns()
    registry.decrementPendingSpawns()
    registry.decrementPendingSpawns() // extra call — must not go negative
    expect(registry.pendingSpawnCount()).toBe(0)
  })
})
