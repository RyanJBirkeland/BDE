/// <reference types="vitest/globals" />
import { sanitizeDependsOn } from './sanitize-depends-on'

describe('sanitizeDependsOn', () => {
  it('returns null for null/undefined', () => {
    expect(sanitizeDependsOn(null)).toBeNull()
    expect(sanitizeDependsOn(undefined)).toBeNull()
  })

  it('parses JSON string', () => {
    const input = JSON.stringify([{ id: 'abc', type: 'hard' }])
    expect(sanitizeDependsOn(input)).toEqual([{ id: 'abc', type: 'hard' }])
  })

  it('handles double-encoded JSON', () => {
    const input = JSON.stringify(JSON.stringify([{ id: 'abc', type: 'hard' }]))
    expect(sanitizeDependsOn(input)).toEqual([{ id: 'abc', type: 'hard' }])
  })

  it('filters invalid entries from array', () => {
    const input = [{ id: 'abc', type: 'hard' }, { id: '', type: 'soft' }, null]
    expect(sanitizeDependsOn(input)).toEqual([{ id: 'abc', type: 'hard' }])
  })

  it('returns null for empty array', () => {
    expect(sanitizeDependsOn([])).toBeNull()
  })

  it('returns null for invalid type', () => {
    expect(sanitizeDependsOn(42)).toBeNull()
  })
})
