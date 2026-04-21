import { RATE_LIMIT_COOLDOWN_MS } from './types'

export interface ConcurrencyState {
  maxSlots: number
  capacityAfterBackpressure: number
  activeCount: number
  recoveryScheduledAt: number | null
  consecutiveRateLimits: number
  atMinimumCapacity: boolean
}

export function makeConcurrencyState(maxSlots: number): ConcurrencyState {
  return {
    maxSlots,
    capacityAfterBackpressure: maxSlots,
    activeCount: 0,
    recoveryScheduledAt: null,
    consecutiveRateLimits: 0,
    atMinimumCapacity: false
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
  const wasRateLimited = s.recoveryScheduledAt !== null
  s.maxSlots = n
  if (s.capacityAfterBackpressure > n) {
    // Lowering — clamp down.
    s.capacityAfterBackpressure = n
  } else if (!wasRateLimited && s.capacityAfterBackpressure < n) {
    // Raising while healthy — open the new slots immediately so the drain
    // loop can use them. If we were rate-limited, leave capacityAfterBackpressure as-is
    // it is so tryRecover() still owns the gradual reopen back up to maxSlots.
    s.capacityAfterBackpressure = n
  }
  s.atMinimumCapacity = s.capacityAfterBackpressure <= 1
}

/** @param activeCount - pass activeAgents.size to avoid stale counter races */
export function availableSlots(s: ConcurrencyState, activeCount?: number): number {
  return Math.max(0, s.capacityAfterBackpressure - (activeCount ?? s.activeCount))
}

export function applyBackpressure(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.atMinimumCapacity) return { ...s, consecutiveRateLimits: s.consecutiveRateLimits + 1 }
  const newSlots = Math.max(1, s.capacityAfterBackpressure - 1)
  return {
    ...s,
    capacityAfterBackpressure: newSlots,
    recoveryScheduledAt: now + RATE_LIMIT_COOLDOWN_MS,
    consecutiveRateLimits: s.consecutiveRateLimits + 1,
    atMinimumCapacity: newSlots <= 1
  }
}

export function tryRecover(s: ConcurrencyState, now: number): ConcurrencyState {
  if (
    s.recoveryScheduledAt !== null &&
    now >= s.recoveryScheduledAt &&
    s.capacityAfterBackpressure < s.maxSlots
  ) {
    const newSlots = Math.min(s.maxSlots, s.capacityAfterBackpressure + 1)
    return {
      ...s,
      capacityAfterBackpressure: newSlots,
      recoveryScheduledAt: newSlots < s.maxSlots ? now + RATE_LIMIT_COOLDOWN_MS : null,
      consecutiveRateLimits: 0,
      atMinimumCapacity: false
    }
  }
  return s
}
