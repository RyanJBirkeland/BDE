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
  it('returns bde-status-review for open PR status', () => {
    expect(getDotColor('active', 'open')).toBe('var(--bde-status-review)')
  })

  it('returns bde-status-review for branch_only PR status', () => {
    expect(getDotColor('active', 'branch_only')).toBe('var(--bde-status-review)')
  })

  it('returns bde-accent for queued status', () => {
    expect(getDotColor('queued')).toBe('var(--bde-accent)')
  })

  it('returns bde-warning for blocked status', () => {
    expect(getDotColor('blocked')).toBe('var(--bde-warning)')
  })

  it('returns bde-status-active for active status', () => {
    expect(getDotColor('active')).toBe('var(--bde-status-active)')
  })

  it('returns bde-status-review for review status', () => {
    expect(getDotColor('review')).toBe('var(--bde-status-review)')
  })

  it('returns bde-status-done for done status', () => {
    expect(getDotColor('done')).toBe('var(--bde-status-done)')
  })

  it('returns bde-danger for failed status', () => {
    expect(getDotColor('failed')).toBe('var(--bde-danger)')
  })

  it('returns bde-danger for error status', () => {
    expect(getDotColor('error')).toBe('var(--bde-danger)')
  })

  it('returns bde-danger for cancelled status', () => {
    expect(getDotColor('cancelled')).toBe('var(--bde-danger)')
  })

  it('returns bde-accent for unknown status (default)', () => {
    expect(getDotColor('backlog')).toBe('var(--bde-accent)')
  })

  it('prioritizes PR status over task status', () => {
    // Even if task is "done", open PR overrides
    expect(getDotColor('done', 'open')).toBe('var(--bde-status-review)')
  })

  it('ignores null/undefined PR status', () => {
    expect(getDotColor('active', null)).toBe('var(--bde-status-active)')
    expect(getDotColor('active', undefined)).toBe('var(--bde-status-active)')
  })
})
