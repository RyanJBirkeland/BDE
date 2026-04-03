import { describe, it, expect } from 'vitest'
import { shortKey, formatDate } from '../format'

describe('shortKey', () => {
  it('returns last segment of colon-delimited key', () => {
    expect(shortKey('project:repo:feature')).toBe('feature')
  })

  it('returns "Session" for hex-like last segments (UUID-like)', () => {
    expect(shortKey('project:abc123def4')).toBe('Session')
    expect(shortKey('aabbccdd')).toBe('Session')
  })

  it('returns the key itself when no colons', () => {
    expect(shortKey('myBranch')).toBe('myBranch')
  })

  it('returns "Session" for full UUIDs without hyphens', () => {
    expect(shortKey('a1b2c3d4e5f6a7b8')).toBe('Session')
  })

  it('returns non-hex last segments as-is', () => {
    expect(shortKey('project:main')).toBe('main')
    expect(shortKey('org:repo:fix-bug')).toBe('fix-bug')
  })
})

describe('formatDate', () => {
  it('returns em-dash for null input', () => {
    expect(formatDate(null)).toBe('\u2014')
  })

  it('returns em-dash for empty string', () => {
    expect(formatDate('')).toBe('\u2014')
  })

  it('formats a valid ISO date to short locale format', () => {
    const result = formatDate('2026-01-05T12:00:00Z')
    // Locale-dependent but should contain month abbreviation and day
    expect(result).toMatch(/Jan\s+\d+/)
  })

  it('formats December date correctly', () => {
    const result = formatDate('2026-12-25T12:00:00Z')
    expect(result).toMatch(/Dec\s+25/)
  })

  it('formats various months', () => {
    expect(formatDate('2026-03-16T12:00:00Z')).toMatch(/Mar\s+16/)
    expect(formatDate('2026-07-04T12:00:00Z')).toMatch(/Jul\s+4/)
  })
})
