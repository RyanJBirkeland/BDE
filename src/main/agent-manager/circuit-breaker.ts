/**
 * Circuit breaker for agent spawn failures.
 *
 * After N consecutive spawn failures, pauses the drain loop for M minutes
 * to avoid thrashing on systemic issues (expired token, broken SDK, etc.).
 *
 * Extracted from AgentManagerImpl to isolate failure tracking logic and
 * reduce index.ts file size.
 */

import { broadcast } from '../broadcast'
import type { Logger } from './types'

/**
 * Number of consecutive spawn failures that trips the circuit breaker.
 * Tuned for "broken Claude SDK/CLI" failures rather than transient blips —
 * 5 in a row across distinct tasks strongly suggests a global problem.
 */
export const SPAWN_CIRCUIT_FAILURE_THRESHOLD = 5

/**
 * How long the drain loop pauses spawning new agents once the circuit
 * is open. Long enough that an upstream incident (network blip, expired
 * token, busted CLI install) is unlikely to still be present.
 */
export const SPAWN_CIRCUIT_PAUSE_MS = 5 * 60 * 1000 // 5 minutes

export class CircuitBreaker {
  private consecutiveFailures = 0
  private openUntil = 0

  constructor(private readonly logger: Logger) {}

  /**
   * Reset the circuit breaker counter on a successful agent spawn.
   * If the circuit was open, also clear the open-until timestamp.
   */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.openUntil > 0) {
      this.logger.info(
        `[circuit-breaker] Spawn succeeded — resetting circuit breaker (was ${this.consecutiveFailures} failures)`
      )
    }
    this.consecutiveFailures = 0
    this.openUntil = 0
  }

  /**
   * Track a spawn failure and trip the breaker if the consecutive count
   * crosses the threshold. Emits a renderer event so the UI can warn.
   */
  recordFailure(): void {
    this.consecutiveFailures += 1
    this.logger.warn(
      `[circuit-breaker] Spawn failure ${this.consecutiveFailures}/${SPAWN_CIRCUIT_FAILURE_THRESHOLD}`
    )
    if (this.consecutiveFailures >= SPAWN_CIRCUIT_FAILURE_THRESHOLD && this.openUntil === 0) {
      this.openUntil = Date.now() + SPAWN_CIRCUIT_PAUSE_MS
      this.logger.error(
        `[circuit-breaker] Circuit breaker OPEN — pausing drain for ${Math.round(
          SPAWN_CIRCUIT_PAUSE_MS / 1000
        )}s after ${this.consecutiveFailures} consecutive failures`
      )
      try {
        broadcast('agent-manager:circuit-breaker-open', {
          consecutiveFailures: this.consecutiveFailures,
          openUntil: this.openUntil
        })
      } catch (err) {
        this.logger.warn(`[circuit-breaker] Failed to broadcast circuit-breaker event: ${err}`)
      }
    }
  }

  /**
   * Returns true if the circuit breaker is currently open. Auto-resets if
   * the pause window has elapsed.
   */
  isOpen(now: number = Date.now()): boolean {
    if (this.openUntil === 0) return false
    if (now >= this.openUntil) {
      this.logger.info('[circuit-breaker] Pause elapsed — resuming drain')
      this.openUntil = 0
      this.consecutiveFailures = 0
      return false
    }
    return true
  }

  /**
   * Exposed for testing — get current failure count.
   */
  get failureCount(): number {
    return this.consecutiveFailures
  }

  /**
   * Exposed for testing — get open-until timestamp.
   */
  get openUntilTimestamp(): number {
    return this.openUntil
  }
}
