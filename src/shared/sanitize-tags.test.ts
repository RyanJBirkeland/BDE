/// <reference types="vitest/globals" />
import { sanitizeTags } from './sanitize-tags'

describe('sanitizeTags', () => {
  it('returns null for null/undefined', () => {
    expect(sanitizeTags(null)).toBeNull()
    expect(sanitizeTags(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(sanitizeTags('')).toBeNull()
    expect(sanitizeTags('   ')).toBeNull()
  })

  it('parses a JSON array string', () => {
    expect(sanitizeTags('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('parses legacy comma-separated string (seeded via direct SQL)', () => {
    expect(sanitizeTags('T-103,E8,architecture,P2')).toEqual(['T-103', 'E8', 'architecture', 'P2'])
  })

  it('trims whitespace in comma-separated values', () => {
    expect(sanitizeTags(' T-1 , E2 ')).toEqual(['T-1', 'E2'])
  })

  it('treats a single bare word as a single-tag list', () => {
    expect(sanitizeTags('solo')).toEqual(['solo'])
  })

  it('filters empty entries from CSV', () => {
    expect(sanitizeTags('a,,b,')).toEqual(['a', 'b'])
  })

  it('returns null when CSV contains only empty entries', () => {
    expect(sanitizeTags(',,,')).toBeNull()
  })

  it('validates array input and drops non-string entries', () => {
    expect(sanitizeTags(['a', '', 'b', 42, null])).toEqual(['a', 'b'])
  })

  it('returns null for empty array', () => {
    expect(sanitizeTags([])).toBeNull()
  })

  it('returns null for invalid type', () => {
    expect(sanitizeTags(42)).toBeNull()
    expect(sanitizeTags({})).toBeNull()
  })
})
