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
  return {
    maxSlots,
    effectiveSlots: maxSlots,
    activeCount: 0,
    recoveryDueAt: null,
    consecutiveRateLimits: 0,
    atFloor: false
  }
}

/**
 * Update the concurrency cap in place without losing live state (activeCount,
 * rate-limit recovery progress, etc.). Used by `reloadConfig` when the user
 * changes `agentManager.maxConcurrent` from the Settings UI.
 *
 * Semantics:
 * - When LOWERED below current `activeCount`, `availableSlots()` returns 0
 *   until enough in-flight agents drain. The drain loop must NOT spawn new
 *   agents in that window.
 * - When RAISED, the new slots become available immediately.
 *
 * `activeCount` is preserved because it reflects the actual number of agents
 * the manager is currently running — it's the source of truth, not the cap.
 */
export function setMaxSlots(s: ConcurrencyState, n: number): void {
  const wasRateLimited = s.recoveryDueAt !== null
  s.maxSlots = n
  if (s.effectiveSlots > n) {
    // Lowering — clamp down.
    s.effectiveSlots = n
  } else if (!wasRateLimited && s.effectiveSlots < n) {
    // Raising while healthy — open the new slots immediately so the drain
    // loop can use them. If we were rate-limited, leave effectiveSlots where
    // it is so tryRecover() still owns the gradual reopen back up to maxSlots.
    s.effectiveSlots = n
  }
  s.atFloor = s.effectiveSlots <= 1
}

/** @param activeCount - pass activeAgents.size to avoid stale counter races */
export function availableSlots(s: ConcurrencyState, activeCount?: number): number {
  return Math.max(0, s.effectiveSlots - (activeCount ?? s.activeCount))
}

export function applyBackpressure(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.atFloor) return { ...s, consecutiveRateLimits: s.consecutiveRateLimits + 1 }
  const newSlots = Math.max(1, s.effectiveSlots - 1)
  return {
    ...s,
    effectiveSlots: newSlots,
    recoveryDueAt: now + RATE_LIMIT_COOLDOWN_MS,
    consecutiveRateLimits: s.consecutiveRateLimits + 1,
    atFloor: newSlots <= 1
  }
}

export function tryRecover(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.recoveryDueAt !== null && now >= s.recoveryDueAt && s.effectiveSlots < s.maxSlots) {
    const newSlots = Math.min(s.maxSlots, s.effectiveSlots + 1)
    return {
      ...s,
      effectiveSlots: newSlots,
      recoveryDueAt: newSlots < s.maxSlots ? now + RATE_LIMIT_COOLDOWN_MS : null,
      consecutiveRateLimits: 0,
      atFloor: false
    }
  }
  return s
}
