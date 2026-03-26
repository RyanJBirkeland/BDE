import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { groupUnifiedAgents, getStaleLevel, type UnifiedAgent } from '../../hooks/useUnifiedAgents'
import type { LocalAgent } from '../../../../shared/types'

const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
const SEVEN_DAYS = 7 * ONE_DAY

function makeAgent(overrides: Partial<LocalAgent> = {}): UnifiedAgent {
  return {
    id: 'test-1',
    label: 'Test Agent',
    source: 'local',
    status: 'done',
    model: 'sonnet',
    updatedAt: Date.now(),
    startedAt: Date.now(),
    canSteer: false,
    canKill: false,
    pid: 1234,
    ...overrides
  }
}

describe('groupUnifiedAgents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('active contains running agents', () => {
    const running = makeAgent({ id: 'r1', status: 'running', startedAt: Date.now() })
    const done = makeAgent({ id: 'd1', status: 'done', updatedAt: Date.now() })

    const groups = groupUnifiedAgents([running, done])
    expect(groups.active).toHaveLength(1)
    expect(groups.active[0].id).toBe('r1')
  })

  it('recent contains non-running agents updated within 24h', () => {
    const now = Date.now()
    const recent = makeAgent({ id: 'r1', status: 'done', updatedAt: now - ONE_HOUR })
    const old = makeAgent({ id: 'o1', status: 'done', updatedAt: now - ONE_DAY - 1000 })

    const groups = groupUnifiedAgents([recent, old])
    expect(groups.recent).toHaveLength(1)
    expect(groups.recent[0].id).toBe('r1')
  })

  it('history contains non-running agents older than 24h', () => {
    const now = Date.now()
    const old = makeAgent({ id: 'o1', status: 'done', updatedAt: now - ONE_DAY - 1000 })

    const groups = groupUnifiedAgents([old])
    expect(groups.history).toHaveLength(1)
    expect(groups.history[0].id).toBe('o1')
  })

  it('sorts active by startedAt descending', () => {
    const now = Date.now()
    const first = makeAgent({ id: 'a', status: 'running', startedAt: now - 1000 })
    const second = makeAgent({ id: 'b', status: 'running', startedAt: now })

    const groups = groupUnifiedAgents([first, second])
    expect(groups.active[0].id).toBe('b')
    expect(groups.active[1].id).toBe('a')
  })

  it('sorts recent by updatedAt descending', () => {
    const now = Date.now()
    const older = makeAgent({ id: 'a', status: 'done', updatedAt: now - ONE_HOUR * 2 })
    const newer = makeAgent({ id: 'b', status: 'done', updatedAt: now - ONE_HOUR })

    const groups = groupUnifiedAgents([older, newer])
    expect(groups.recent[0].id).toBe('b')
    expect(groups.recent[1].id).toBe('a')
  })
})

describe('getStaleLevel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns fresh for agents updated less than 1 hour ago', () => {
    const agent = makeAgent({ updatedAt: Date.now() - 30 * 60 * 1000 })
    expect(getStaleLevel(agent)).toBe('fresh')
  })

  it('returns aging for agents updated 1-24 hours ago', () => {
    const agent = makeAgent({ updatedAt: Date.now() - 6 * ONE_HOUR })
    expect(getStaleLevel(agent)).toBe('aging')
  })

  it('returns stale for agents updated 1-7 days ago', () => {
    const agent = makeAgent({ updatedAt: Date.now() - 3 * ONE_DAY })
    expect(getStaleLevel(agent)).toBe('stale')
  })

  it('returns dead for agents updated more than 7 days ago', () => {
    const agent = makeAgent({ updatedAt: Date.now() - SEVEN_DAYS - 1000 })
    expect(getStaleLevel(agent)).toBe('dead')
  })
})
