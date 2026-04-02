import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { groupUnifiedAgents } from '../useUnifiedAgents'
import type { UnifiedAgent } from '../useUnifiedAgents'

const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR

let idCounter = 0

function makeAgent(overrides: Partial<UnifiedAgent> = {}): UnifiedAgent {
  const id = `agent-${++idCounter}`
  const now = Date.now()
  const base = {
    id,
    label: `Agent ${id}`,
    status: 'done' as const,
    model: 'claude-3-5-sonnet',
    updatedAt: now - ONE_HOUR,
    startedAt: now - 2 * ONE_HOUR,
    source: 'history' as const,
    historyId: `hist-${id}`
  }
  return { ...base, ...overrides } as UnifiedAgent
}

describe('groupUnifiedAgents', () => {
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    idCounter = 0
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all empty buckets for an empty array', () => {
    const result = groupUnifiedAgents([])
    expect(result.active).toHaveLength(0)
    expect(result.recent).toHaveLength(0)
    expect(result.history).toHaveLength(0)
  })

  it('places a running agent into active bucket', () => {
    const agent = makeAgent({ status: 'running', updatedAt: NOW - ONE_HOUR, startedAt: NOW - 2 * ONE_HOUR })
    const result = groupUnifiedAgents([agent])
    expect(result.active).toHaveLength(1)
    expect(result.active[0].id).toBe(agent.id)
    expect(result.recent).toHaveLength(0)
    expect(result.history).toHaveLength(0)
  })

  it('places a recently completed agent (< 1 day ago) into recent bucket', () => {
    const agent = makeAgent({ status: 'done', updatedAt: NOW - ONE_HOUR * 2 })
    const result = groupUnifiedAgents([agent])
    expect(result.recent).toHaveLength(1)
    expect(result.recent[0].id).toBe(agent.id)
    expect(result.active).toHaveLength(0)
    expect(result.history).toHaveLength(0)
  })

  it('places an old agent (> 1 day ago) into history bucket', () => {
    const agent = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY - ONE_HOUR })
    const result = groupUnifiedAgents([agent])
    expect(result.history).toHaveLength(1)
    expect(result.history[0].id).toBe(agent.id)
    expect(result.active).toHaveLength(0)
    expect(result.recent).toHaveLength(0)
  })

  it('correctly buckets mixed agents', () => {
    const running = makeAgent({ status: 'running', updatedAt: NOW - 100, startedAt: NOW - 1000 })
    const recentDone = makeAgent({ status: 'done', updatedAt: NOW - ONE_HOUR })
    const recentFailed = makeAgent({ status: 'failed', updatedAt: NOW - ONE_HOUR * 12 })
    const oldAgent = makeAgent({ status: 'cancelled', updatedAt: NOW - ONE_DAY * 3 })

    const result = groupUnifiedAgents([running, recentDone, recentFailed, oldAgent])

    expect(result.active).toHaveLength(1)
    expect(result.active[0].id).toBe(running.id)

    expect(result.recent).toHaveLength(2)
    const recentIds = result.recent.map((a) => a.id)
    expect(recentIds).toContain(recentDone.id)
    expect(recentIds).toContain(recentFailed.id)

    expect(result.history).toHaveLength(1)
    expect(result.history[0].id).toBe(oldAgent.id)
  })

  it('sorts active bucket by startedAt descending', () => {
    const older = makeAgent({ status: 'running', startedAt: NOW - 3 * ONE_HOUR, updatedAt: NOW - ONE_HOUR })
    const newer = makeAgent({ status: 'running', startedAt: NOW - ONE_HOUR, updatedAt: NOW - 100 })
    const middle = makeAgent({ status: 'running', startedAt: NOW - 2 * ONE_HOUR, updatedAt: NOW - 30 * 60 * 1000 })

    const result = groupUnifiedAgents([older, newer, middle])

    expect(result.active[0].id).toBe(newer.id)
    expect(result.active[1].id).toBe(middle.id)
    expect(result.active[2].id).toBe(older.id)
  })

  it('sorts recent bucket by updatedAt descending', () => {
    const earliest = makeAgent({ status: 'done', updatedAt: NOW - ONE_HOUR * 20 })
    const latest = makeAgent({ status: 'done', updatedAt: NOW - ONE_HOUR })
    const mid = makeAgent({ status: 'done', updatedAt: NOW - ONE_HOUR * 10 })

    const result = groupUnifiedAgents([earliest, latest, mid])

    expect(result.recent[0].id).toBe(latest.id)
    expect(result.recent[1].id).toBe(mid.id)
    expect(result.recent[2].id).toBe(earliest.id)
  })

  it('sorts history bucket by updatedAt descending', () => {
    const oldest = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY * 10 })
    const newest = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY * 2 })
    const middle = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY * 5 })

    const result = groupUnifiedAgents([oldest, newest, middle])

    expect(result.history[0].id).toBe(newest.id)
    expect(result.history[1].id).toBe(middle.id)
    expect(result.history[2].id).toBe(oldest.id)
  })

  it('places agent at exactly ONE_DAY threshold into history (not recent)', () => {
    // updatedAt === now - ONE_DAY: condition is `updatedAt > now - ONE_DAY` → false → history
    const agent = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY })
    const result = groupUnifiedAgents([agent])
    expect(result.history).toHaveLength(1)
    expect(result.history[0].id).toBe(agent.id)
    expect(result.recent).toHaveLength(0)
  })

  it('places agent just inside ONE_DAY threshold into recent', () => {
    // updatedAt === now - ONE_DAY + 1 → recent
    const agent = makeAgent({ status: 'done', updatedAt: NOW - ONE_DAY + 1 })
    const result = groupUnifiedAgents([agent])
    expect(result.recent).toHaveLength(1)
    expect(result.recent[0].id).toBe(agent.id)
    expect(result.history).toHaveLength(0)
  })
})
