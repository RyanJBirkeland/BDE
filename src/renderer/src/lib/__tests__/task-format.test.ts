import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatElapsed, getDotColor } from '../task-format'

describe('formatElapsed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns minutes and seconds for durations under 1 hour', () => {
    vi.useFakeTimers({ now: 300_000 }) // 5 minutes
    expect(formatElapsed(new Date(0).toISOString())).toBe('5m 0s')
  })

  it('returns 0s for very short durations', () => {
    vi.useFakeTimers({ now: 10_000 })
    expect(formatElapsed(new Date(0).toISOString())).toBe('10s')
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
  it('returns fleet-status-review for open PR status', () => {
    expect(getDotColor('active', 'open')).toBe('var(--fleet-status-review)')
  })

  it('returns fleet-status-review for branch_only PR status', () => {
    expect(getDotColor('active', 'branch_only')).toBe('var(--fleet-status-review)')
  })

  it('returns fleet-accent for queued status', () => {
    expect(getDotColor('queued')).toBe('var(--fleet-accent)')
  })

  it('returns fleet-warning for blocked status', () => {
    expect(getDotColor('blocked')).toBe('var(--fleet-warning)')
  })

  it('returns fleet-status-active for active status', () => {
    expect(getDotColor('active')).toBe('var(--fleet-status-active)')
  })

  it('returns fleet-status-review for review status', () => {
    expect(getDotColor('review')).toBe('var(--fleet-status-review)')
  })

  it('returns fleet-status-done for done status', () => {
    expect(getDotColor('done')).toBe('var(--fleet-status-done)')
  })

  it('returns fleet-danger for failed status', () => {
    expect(getDotColor('failed')).toBe('var(--fleet-danger)')
  })

  it('returns fleet-danger for error status', () => {
    expect(getDotColor('error')).toBe('var(--fleet-danger)')
  })

  it('returns fleet-danger for cancelled status', () => {
    expect(getDotColor('cancelled')).toBe('var(--fleet-danger)')
  })

  it('returns fleet-accent for unknown status (default)', () => {
    expect(getDotColor('backlog')).toBe('var(--fleet-accent)')
  })

  it('prioritizes PR status over task status', () => {
    // Even if task is "done", open PR overrides
    expect(getDotColor('done', 'open')).toBe('var(--fleet-status-review)')
  })

  it('ignores null/undefined PR status', () => {
    expect(getDotColor('active', null)).toBe('var(--fleet-status-active)')
    expect(getDotColor('active', undefined)).toBe('var(--fleet-status-active)')
  })
})
