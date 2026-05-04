import { describe, it, expect } from 'vitest'
import { hasNoCommitsAheadOfMain } from '../resolve-git'

describe('hasNoCommitsAheadOfMain', () => {
  it('returns true when rev-list output is "0"', () => {
    expect(hasNoCommitsAheadOfMain('0')).toBe(true)
  })

  it('returns true when rev-list output has leading/trailing whitespace', () => {
    expect(hasNoCommitsAheadOfMain('  0  ')).toBe(true)
    expect(hasNoCommitsAheadOfMain('0\n')).toBe(true)
  })

  it('returns false when there is one commit ahead', () => {
    expect(hasNoCommitsAheadOfMain('1')).toBe(false)
  })

  it('returns false when there are multiple commits ahead', () => {
    expect(hasNoCommitsAheadOfMain('5')).toBe(false)
    expect(hasNoCommitsAheadOfMain('42')).toBe(false)
  })

  it('returns false for non-numeric output', () => {
    // parseInt on non-numeric returns NaN, NaN === 0 is false
    expect(hasNoCommitsAheadOfMain('not-a-number')).toBe(false)
    expect(hasNoCommitsAheadOfMain('')).toBe(false)
  })
})
