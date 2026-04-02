import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  timeAgo,
  formatElapsed,
  formatDuration,
  modelBadgeLabel,
  repoBadgeVariant,
  repoColor,
  formatTime
} from '../format'

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for timestamps less than 60s ago', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    expect(timeAgo(1_000_000)).toBe('just now')
    expect(timeAgo(1_000_000 - 59_000)).toBe('just now')
  })

  it('returns "1m ago" at exactly 60 seconds', () => {
    vi.useFakeTimers({ now: 120_000 })
    expect(timeAgo(60_000)).toBe('1m ago')
  })

  it('returns minutes for timestamps under 1 hour', () => {
    vi.useFakeTimers({ now: 3_600_000 })
    expect(timeAgo(3_600_000 - 30 * 60_000)).toBe('30m ago')
    expect(timeAgo(3_600_000 - 59 * 60_000)).toBe('59m ago')
  })

  it('returns hours for timestamps under 48 hours', () => {
    vi.useFakeTimers({ now: 48 * 3_600_000 })
    expect(timeAgo(47 * 3_600_000)).toBe('1h ago')
    expect(timeAgo(1 * 3_600_000)).toBe('47h ago')
  })

  it('returns days once 48h boundary is crossed', () => {
    vi.useFakeTimers({ now: 72 * 3_600_000 })
    expect(timeAgo(0)).toBe('3d ago')
  })

  it('accepts ISO date strings', () => {
    const now = new Date('2026-03-16T12:00:00Z').getTime()
    vi.useFakeTimers({ now })
    expect(timeAgo('2026-03-16T11:50:00Z')).toBe('10m ago')
  })
})

describe('formatElapsed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns seconds for durations under 1 minute', () => {
    vi.useFakeTimers({ now: 45_000 })
    expect(formatElapsed(0)).toBe('45s')
  })

  it('returns 0s when start equals now', () => {
    vi.useFakeTimers({ now: 10_000 })
    expect(formatElapsed(10_000)).toBe('0s')
  })

  it('returns minutes and seconds for durations under 1 hour', () => {
    vi.useFakeTimers({ now: 192_000 }) // 3m 12s
    expect(formatElapsed(0)).toBe('3m 12s')
  })

  it('returns hours and minutes for durations >= 1 hour', () => {
    vi.useFakeTimers({ now: 3_720_000 }) // 1h 2m
    expect(formatElapsed(0)).toBe('1h 2m')
  })

  it('clamps negative durations to 0s', () => {
    vi.useFakeTimers({ now: 0 })
    expect(formatElapsed(5_000)).toBe('0s')
  })
})

describe('formatDuration', () => {
  it('returns empty string when finishedAt is null', () => {
    expect(formatDuration(0, null)).toBe('')
  })

  it('formats 45s duration', () => {
    expect(formatDuration(0, 45_000)).toBe('45s')
  })

  it('formats 3m 12s duration', () => {
    expect(formatDuration(0, 192_000)).toBe('3m 12s')
  })

  it('formats hour-level duration', () => {
    expect(formatDuration(0, 3_720_000)).toBe('1h 2m')
  })

  it('accepts ISO date strings', () => {
    expect(formatDuration('2026-03-16T12:00:00Z', '2026-03-16T12:03:12Z')).toBe('3m 12s')
  })
})

describe('modelBadgeLabel', () => {
  it('extracts "sonnet" from claude-sonnet model strings', () => {
    expect(modelBadgeLabel('claude-sonnet-4-6-20250929')).toBe('sonnet')
  })

  it('extracts "haiku" from claude-haiku model strings', () => {
    expect(modelBadgeLabel('claude-haiku-4-5-20251001')).toBe('haiku')
  })

  it('extracts "opus" from claude-opus model strings', () => {
    expect(modelBadgeLabel('claude-opus-4-6')).toBe('opus')
  })

  it('returns first segment for GPT models', () => {
    expect(modelBadgeLabel('gpt-4-turbo')).toBe('gpt')
  })

  it('returns full string when no dash is present', () => {
    expect(modelBadgeLabel('custom')).toBe('custom')
  })
})

describe('repoBadgeVariant', () => {
  it('returns "info" for BDE (case-insensitive)', () => {
    expect(repoBadgeVariant('BDE')).toBe('info')
    expect(repoBadgeVariant('bde')).toBe('info')
  })

  it('returns "warning" for feast', () => {
    expect(repoBadgeVariant('feast')).toBe('warning')
    expect(repoBadgeVariant('Feast')).toBe('warning')
  })

  it('returns "success" for life-os', () => {
    expect(repoBadgeVariant('life-os')).toBe('success')
  })

  it('returns "default" for unknown repos', () => {
    expect(repoBadgeVariant('other')).toBe('default')
  })
})

describe('repoColor', () => {
  it('returns the configured color for known repos', () => {
    expect(repoColor('BDE')).toBe('#6C8EEF')
    expect(repoColor('life-os')).toBe('#00D37F')
    expect(repoColor('feast')).toBe('#FF8A00')
  })

  it('is case-insensitive', () => {
    expect(repoColor('bde')).toBe('#6C8EEF')
  })

  it('returns fallback for unknown repos', () => {
    expect(repoColor('unknown')).toBe('var(--bde-text-dim)')
  })
})

describe('formatTime', () => {
  it('formats an ISO string to locale time', () => {
    const result = formatTime('2026-03-16T14:34:00Z')
    expect(result).toBeTruthy()
  })

  it('accepts epoch-ms numbers', () => {
    const result = formatTime(1710600840000)
    expect(result).toBeTruthy()
  })
})
