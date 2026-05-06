import { describe, it, expect } from 'vitest'
import { nextDependencyCondition } from '../epicDependencyUtils'

describe('nextDependencyCondition', () => {
  it('cycles on_success → always', () => {
    expect(nextDependencyCondition('on_success')).toBe('always')
  })

  it('cycles always → manual', () => {
    expect(nextDependencyCondition('always')).toBe('manual')
  })

  it('cycles manual → on_success', () => {
    expect(nextDependencyCondition('manual')).toBe('on_success')
  })
})
