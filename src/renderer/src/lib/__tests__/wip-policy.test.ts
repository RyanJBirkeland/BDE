import { describe, it, expect } from 'vitest'
import { canLaunchTask } from '../wip-policy'

describe('canLaunchTask', () => {
  it('returns true when activeCount is below max', () => {
    expect(canLaunchTask(1, 3)).toBe(true)
  })

  it('returns false when activeCount equals max', () => {
    expect(canLaunchTask(3, 3)).toBe(false)
  })

  it('returns false when activeCount exceeds max', () => {
    expect(canLaunchTask(5, 3)).toBe(false)
  })

  it('returns false when max is 0', () => {
    expect(canLaunchTask(0, 0)).toBe(false)
  })
})
