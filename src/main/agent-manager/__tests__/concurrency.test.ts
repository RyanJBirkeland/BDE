import { describe, test, expect } from 'vitest'
import {
  makeConcurrencyState,
  setMaxSlots,
  availableSlots,
  applyBackpressure,
  tryRecover
} from '../concurrency'

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
    expect(next.capacityAfterBackpressure).toBe(1)
    expect(next.atMinimumCapacity).toBe(true)
  })

  test('at floor, backpressure does not reset recoveryScheduledAt', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 1000)
    const rd = s.recoveryScheduledAt
    s = applyBackpressure(s, 2000)
    expect(s.recoveryScheduledAt).toBe(rd)
    expect(s.consecutiveRateLimits).toBe(2)
  })

  test('tryRecover increments after cooldown', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 0)
    s = tryRecover(s, 60_001)
    expect(s.capacityAfterBackpressure).toBe(2)
    expect(s.atMinimumCapacity).toBe(false)
    expect(s.recoveryScheduledAt).toBeNull()
  })

  test('tryRecover does nothing before cooldown', () => {
    let s = makeConcurrencyState(3)
    s = applyBackpressure(s, 0)
    s = tryRecover(s, 30_000)
    expect(s.capacityAfterBackpressure).toBe(2)
  })

  describe('setMaxSlots (reloadConfig)', () => {
    test('lowering cap below activeCount yields zero available slots', () => {
      // Simulate 5 agents in flight with previous cap of 8.
      const s = makeConcurrencyState(8)
      s.activeCount = 5
      // Lower to 2 — drain loop should NOT spawn more.
      setMaxSlots(s, 2)
      expect(s.maxSlots).toBe(2)
      expect(s.capacityAfterBackpressure).toBe(2)
      expect(availableSlots(s)).toBe(0)
      // activeCount preserved — in-flight agents still tracked.
      expect(s.activeCount).toBe(5)
    })

    test('lowering cap then draining gradually frees slots', () => {
      const s = makeConcurrencyState(8)
      s.activeCount = 5
      setMaxSlots(s, 2)
      expect(availableSlots(s)).toBe(0)
      // 4 agents finish → activeCount=1 → 1 slot available (max=2).
      s.activeCount = 1
      expect(availableSlots(s)).toBe(1)
    })

    test('raising cap immediately makes new slots available', () => {
      const s = makeConcurrencyState(2)
      s.activeCount = 2
      expect(availableSlots(s)).toBe(0)
      setMaxSlots(s, 8)
      expect(s.maxSlots).toBe(8)
      expect(s.capacityAfterBackpressure).toBe(8)
      expect(availableSlots(s)).toBe(6)
    })

    test('atMinimumCapacity flag tracks new capacityAfterBackpressure after lowering', () => {
      const s = makeConcurrencyState(8)
      setMaxSlots(s, 1)
      expect(s.capacityAfterBackpressure).toBe(1)
      expect(s.atMinimumCapacity).toBe(true)
    })

    test('lowering does not clobber rate-limited capacityAfterBackpressure when below new cap', () => {
      // Rate-limited from 8 down to 3.
      let s = makeConcurrencyState(8)
      s = applyBackpressure(s, 0)
      s = applyBackpressure(s, 0)
      s = applyBackpressure(s, 0)
      s = applyBackpressure(s, 0)
      s = applyBackpressure(s, 0)
      expect(s.capacityAfterBackpressure).toBe(3)
      // User sets max=5. capacityAfterBackpressure (3) is already below 5 — leave it.
      setMaxSlots(s, 5)
      expect(s.maxSlots).toBe(5)
      expect(s.capacityAfterBackpressure).toBe(3)
    })
  })
})
