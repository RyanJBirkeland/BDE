/**
 * WIP tracker — thin facade over ConcurrencyState for readable slot queries,
 * plus a `WipTracker` class for active-agent count management.
 *
 * All actual concurrency arithmetic lives in `concurrency.ts`; this module
 * exposes the question-shaped API ("how many slots are free?") used by the
 * drain loop and watchdog so callers never import raw state directly.
 */

import {
  makeConcurrencyState,
  setMaxSlots,
  availableSlots,
  type ConcurrencyState
} from './concurrency'

// ---------------------------------------------------------------------------
// WipTracker class
// ---------------------------------------------------------------------------

/**
 * Wraps the active-agent count with named slot operations.
 *
 * Extracted from `AgentManagerImpl` so WIP accounting has its own SRP
 * boundary. The manager holds one instance and delegates slot queries here.
 * The active count is read through a callback so the view is always live.
 */
export class WipTracker {
  private readonly getActiveCount: () => number

  constructor(getActiveCount: () => number) {
    this.getActiveCount = getActiveCount
  }

  /** Current number of active agents. */
  get count(): number {
    return this.getActiveCount()
  }

  /** True when the active count meets or exceeds `max`. */
  isFull(max: number): boolean {
    return this.count >= max
  }
}

export interface WipTrackerDeps {
  activeAgentCount: () => number
}

/**
 * Create fresh concurrency state for the given `maxSlots`.
 * Delegates to `makeConcurrencyState` — no logic here, just a named entry
 * point so callers import from one place.
 */
export function createConcurrencyState(maxSlots: number): ConcurrencyState {
  return makeConcurrencyState(maxSlots)
}

/**
 * How many task slots are currently free.
 * Returns 0 when fully occupied or over-capacity (e.g. after a settings
 * hot-reload that lowered maxConcurrent below activeCount).
 */
export function getAvailableSlots(concurrency: ConcurrencyState, deps: WipTrackerDeps): number {
  return availableSlots(concurrency, deps.activeAgentCount())
}

/**
 * Update the maximum concurrency cap in-place.
 * Active agents are preserved; if the new cap is lower, `getAvailableSlots`
 * returns 0 until enough agents drain naturally.
 */
export function updateMaxSlots(concurrency: ConcurrencyState, newMax: number): void {
  setMaxSlots(concurrency, newMax)
}
