import { RATE_LIMIT_COOLDOWN_MS } from './types'

export interface ConcurrencyState {
  maxSlots: number
  effectiveSlots: number
  activeCount: number
  recoveryDueAt: number | null
  consecutiveRateLimits: number
  atFloor: boolean
}

export function makeConcurrencyState(maxSlots: number): ConcurrencyState {
  return { maxSlots, effectiveSlots: maxSlots, activeCount: 0, recoveryDueAt: null, consecutiveRateLimits: 0, atFloor: false }
}

/** @param activeCount - pass activeAgents.size to avoid stale counter races */
export function availableSlots(s: ConcurrencyState, activeCount?: number): number {
  return Math.max(0, s.effectiveSlots - (activeCount ?? s.activeCount))
}

export function applyBackpressure(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.atFloor) return { ...s, consecutiveRateLimits: s.consecutiveRateLimits + 1 }
  const newSlots = Math.max(1, s.effectiveSlots - 1)
  return {
    ...s, effectiveSlots: newSlots, recoveryDueAt: now + RATE_LIMIT_COOLDOWN_MS,
    consecutiveRateLimits: s.consecutiveRateLimits + 1, atFloor: newSlots <= 1,
  }
}

export function tryRecover(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.recoveryDueAt !== null && now >= s.recoveryDueAt && s.effectiveSlots < s.maxSlots) {
    const newSlots = Math.min(s.maxSlots, s.effectiveSlots + 1)
    return {
      ...s, effectiveSlots: newSlots,
      recoveryDueAt: newSlots < s.maxSlots ? now + RATE_LIMIT_COOLDOWN_MS : null,
      consecutiveRateLimits: 0, atFloor: false,
    }
  }
  return s
}
