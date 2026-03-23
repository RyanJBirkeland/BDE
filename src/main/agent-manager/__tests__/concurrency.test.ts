import { describe, test, expect } from 'vitest'
import { makeConcurrencyState, availableSlots, applyBackpressure, tryRecover } from '../concurrency'

describe('concurrency', () => {
  test('availableSlots returns effective minus active', () => {
    const s = makeConcurrencyState(3)
    expect(availableSlots({ ...s, activeCount: 1 })).toBe(2)
  })

  test('availableSlots never goes negative', () => {
    const s = makeConcurrencyState(1)
    expect(availableSlots({ ...s, activeCount: 3 })).toBe(0)
  })

  test('applyBackpressure reduces slots', () => {
    const s = makeConcurrencyState(2)
    const next = applyBackpressure(s, 1000)
    expect(next.effectiveSlots).toBe(1)
    expect(next.atFloor).toBe(true)
  })

  test('at floor, backpressure does not reset recoveryDueAt', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 1000)
    const rd = s.recoveryDueAt
    s = applyBackpressure(s, 2000)
    expect(s.recoveryDueAt).toBe(rd)
    expect(s.consecutiveRateLimits).toBe(2)
  })

  test('tryRecover increments after cooldown', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 0)
    s = tryRecover(s, 60_001)
    expect(s.effectiveSlots).toBe(2)
    expect(s.atFloor).toBe(false)
    expect(s.recoveryDueAt).toBeNull()
  })

  test('tryRecover does nothing before cooldown', () => {
    let s = makeConcurrencyState(3)
    s = applyBackpressure(s, 0)
    s = tryRecover(s, 30_000)
    expect(s.effectiveSlots).toBe(2)
  })
})
