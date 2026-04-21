/// <reference types="vitest/globals" />
import { sanitizeEpicDependsOn } from './sanitize-epic-depends-on'

describe('sanitizeEpicDependsOn', () => {
  it('returns empty array for null/undefined', () => {
    expect(sanitizeEpicDependsOn(null)).toEqual([])
    expect(sanitizeEpicDependsOn(undefined)).toEqual([])
  })

  it('returns empty array for empty or whitespace string', () => {
    expect(sanitizeEpicDependsOn('')).toEqual([])
    expect(sanitizeEpicDependsOn('   ')).toEqual([])
  })

  it('parses a valid JSON string', () => {
    const input = JSON.stringify([{ id: 'epic-1', condition: 'on_success' }])
    expect(sanitizeEpicDependsOn(input)).toEqual([{ id: 'epic-1', condition: 'on_success' }])
  })

  it('accepts all valid condition values', () => {
    const input = [
      { id: 'a', condition: 'on_success' },
      { id: 'b', condition: 'always' },
      { id: 'c', condition: 'manual' }
    ]
    expect(sanitizeEpicDependsOn(input)).toEqual(input)
  })

  it('returns empty array for malformed JSON string', () => {
    expect(sanitizeEpicDependsOn('{not-json')).toEqual([])
    expect(sanitizeEpicDependsOn('[{"id":')).toEqual([])
  })

  it('filters out entries with missing id or condition', () => {
    const input = [
      { id: 'good', condition: 'on_success' },
      { id: '', condition: 'on_success' },
      { condition: 'always' },
      { id: 'no-condition' },
      null,
      undefined,
      'string-entry'
    ]
    expect(sanitizeEpicDependsOn(input)).toEqual([{ id: 'good', condition: 'on_success' }])
  })

  it('filters out entries with invalid condition values', () => {
    const input = [
      { id: 'good', condition: 'manual' },
      { id: 'bad', condition: 'on_failure' },
      { id: 'also-bad', condition: 'unknown' },
      { id: 'wrong-type', condition: 42 }
    ]
    expect(sanitizeEpicDependsOn(input)).toEqual([{ id: 'good', condition: 'manual' }])
  })

  it('handles mixed valid and invalid entries', () => {
    const input = [
      { id: 'a', condition: 'always' },
      { id: 'b', condition: 'bogus' },
      { id: 'c', condition: 'on_success' }
    ]
    expect(sanitizeEpicDependsOn(input)).toEqual([
      { id: 'a', condition: 'always' },
      { id: 'c', condition: 'on_success' }
    ])
  })

  it('returns empty array for non-array, non-string, non-nullish types', () => {
    expect(sanitizeEpicDependsOn(42)).toEqual([])
    expect(sanitizeEpicDependsOn(true)).toEqual([])
    expect(sanitizeEpicDependsOn({ id: 'x', condition: 'always' })).toEqual([])
  })

  it('returns empty array for empty array input', () => {
    expect(sanitizeEpicDependsOn([])).toEqual([])
  })
})
