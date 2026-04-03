import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatElapsed, getDotColor } from '../task-format'

describe('formatElapsed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns minutes for durations under 1 hour', () => {
    vi.useFakeTimers({ now: 300_000 }) // 5 minutes
    expect(formatElapsed(new Date(0).toISOString())).toBe('5m')
  })

  it('returns 0m for very short durations', () => {
    vi.useFakeTimers({ now: 10_000 })
    expect(formatElapsed(new Date(0).toISOString())).toBe('0m')
  })

  it('returns hours and minutes for durations >= 1 hour', () => {
    vi.useFakeTimers({ now: 5_400_000 }) // 1h 30m
    expect(formatElapsed(new Date(0).toISOString())).toBe('1h 30m')
  })

  it('returns exact hours with 0 remaining minutes', () => {
    vi.useFakeTimers({ now: 7_200_000 }) // 2h 0m
    expect(formatElapsed(new Date(0).toISOString())).toBe('2h 0m')
  })
})

describe('getDotColor', () => {
  it('returns neon-blue for open PR status', () => {
    expect(getDotColor('active', 'open')).toBe('var(--neon-blue)')
  })

  it('returns neon-blue for branch_only PR status', () => {
    expect(getDotColor('active', 'branch_only')).toBe('var(--neon-blue)')
  })

  it('returns neon-cyan for queued status', () => {
    expect(getDotColor('queued')).toBe('var(--neon-cyan)')
  })

  it('returns neon-orange for blocked status', () => {
    expect(getDotColor('blocked')).toBe('var(--neon-orange)')
  })

  it('returns neon-purple for active status', () => {
    expect(getDotColor('active')).toBe('var(--neon-purple)')
  })

  it('returns neon-blue for review status', () => {
    expect(getDotColor('review')).toBe('var(--neon-blue)')
  })

  it('returns neon-pink for done status', () => {
    expect(getDotColor('done')).toBe('var(--neon-pink)')
  })

  it('returns neon-red for failed status', () => {
    expect(getDotColor('failed')).toBe('var(--neon-red, #ff3366)')
  })

  it('returns neon-red for error status', () => {
    expect(getDotColor('error')).toBe('var(--neon-red, #ff3366)')
  })

  it('returns neon-red for cancelled status', () => {
    expect(getDotColor('cancelled')).toBe('var(--neon-red, #ff3366)')
  })

  it('returns neon-cyan for unknown status (default)', () => {
    expect(getDotColor('backlog')).toBe('var(--neon-cyan)')
  })

  it('prioritizes PR status over task status', () => {
    // Even if task is "done", open PR overrides
    expect(getDotColor('done', 'open')).toBe('var(--neon-blue)')
  })

  it('ignores null/undefined PR status', () => {
    expect(getDotColor('active', null)).toBe('var(--neon-purple)')
    expect(getDotColor('active', undefined)).toBe('var(--neon-purple)')
  })
})
