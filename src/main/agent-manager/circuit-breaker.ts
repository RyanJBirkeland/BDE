/**
 * Circuit breaker for agent spawn failures.
 *
 * After N consecutive spawn failures, pauses the drain loop for M minutes
 * to avoid thrashing on systemic issues (expired token, broken SDK, etc.).
 *
 * Extracted from AgentManagerImpl to isolate failure tracking logic and
 * reduce index.ts file size.
 */

import type { Logger } from '../logger'

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

interface SpawnFailureEntry {
  taskId: string
  reason: string
}

/**
 * Observer interface for circuit-breaker open events.
 * Implement this to receive a structured notification when the breaker trips.
 * The composition root wires the concrete observer (broadcast call) via the
 * constructor so circuit-breaker.ts stays free of framework adapter imports.
 */
export interface CircuitObserver {
  onCircuitOpen(payload: { consecutiveFailures: number; openUntil: number }): void
}

export class CircuitBreaker {
  private consecutiveFailures = 0
  private openUntil = 0
  private recentFailures: SpawnFailureEntry[] = []

  constructor(
    private readonly logger: Logger,
    private readonly observer?: CircuitObserver
  ) {}

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
    this.recentFailures = []
  }

  /**
   * Track a spawn-phase failure and trip the breaker if the consecutive count
   * crosses the threshold. Only call this for spawn-phase failures (before the
   * SDK stream starts) — stream errors must not increment the circuit breaker.
   *
   * Emits a renderer event so the UI can warn. When the circuit opens, logs the
   * triggering task and the full recent-failure history for diagnostics.
   */
  recordFailure(taskId: string = 'unknown', reason: string = 'spawn failed'): void {
    this.consecutiveFailures += 1
    this.recentFailures.push({ taskId, reason })
    this.logger.warn(
      `[circuit-breaker] Spawn failure ${this.consecutiveFailures}/${SPAWN_CIRCUIT_FAILURE_THRESHOLD} — task ${taskId}`
    )
    if (this.consecutiveFailures >= SPAWN_CIRCUIT_FAILURE_THRESHOLD && this.openUntil === 0) {
      this.openUntil = Date.now() + SPAWN_CIRCUIT_PAUSE_MS
      this.logger.error(
        `[circuit-breaker] Circuit breaker OPEN — pausing drain for ${Math.round(
          SPAWN_CIRCUIT_PAUSE_MS / 1000
        )}s after ${this.consecutiveFailures} consecutive spawn-phase failures`
      )
      this.logger.event('circuit-breaker.open', {
        triggeringTask: taskId,
        failureCount: this.consecutiveFailures,
        recentFailures: this.recentFailures.map((f) => ({ taskId: f.taskId, reason: f.reason }))
      })
      try {
        this.observer?.onCircuitOpen({
          consecutiveFailures: this.consecutiveFailures,
          openUntil: this.openUntil
        })
      } catch (err) {
        this.logger.warn(`[circuit-breaker] Failed to emit circuit-breaker event: ${err}`)
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
      const failureCount = this.consecutiveFailures
      const openDurationMs = now - (this.openUntil - SPAWN_CIRCUIT_PAUSE_MS)
      this.openUntil = 0
      this.consecutiveFailures = 0
      this.logger.info(
        `[circuit-breaker] Pause elapsed — resuming drain (was open for ${openDurationMs}ms after ${failureCount} consecutive failures)`
      )
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
