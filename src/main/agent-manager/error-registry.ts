/**
 * ErrorRegistry — groups circuit-breaker state, per-task drain-failure
 * counts, and fast-fail sliding-window tracking behind a single named
 * collaborator.
 *
 * Extracted from AgentManagerImpl so error tracking has its own SRP
 * boundary. The manager holds one instance and delegates to it for all
 * spawn-failure and drain-failure accounting.
 *
 * The underlying `CircuitBreaker` and `drainFailureCounts` map are still
 * owned here; `AgentManagerImpl` accesses them through this class.
 */

import { CircuitBreaker } from './circuit-breaker'
import { FAST_FAIL_THRESHOLD_MS, MAX_FAST_FAILS } from './types'
import type { Logger } from '../logger'

interface FastFailEntry {
  ts: number
  reason: string
}

/**
 * Tracks fast-fail history per task using a true 30-second sliding window.
 *
 * Each fast-fail event is recorded with a timestamp. Before evaluating
 * exhaustion, entries older than `FAST_FAIL_THRESHOLD_MS` are evicted so the
 * count reflects only failures that occurred within the last 30 seconds.
 */
export class FastFailTracker {
  private readonly entries = new Map<string, FastFailEntry[]>()

  /** Record a fast-fail event for the given task at the given timestamp. */
  record(taskId: string, reason: string, now: number = Date.now()): void {
    const history = this.entries.get(taskId) ?? []
    history.push({ ts: now, reason })
    this.entries.set(taskId, history)
  }

  /**
   * Returns the number of fast-fail events within the sliding window.
   * Evicts stale entries (older than FAST_FAIL_THRESHOLD_MS) before counting.
   */
  recentCount(taskId: string, now: number = Date.now()): number {
    const history = this.entries.get(taskId)
    if (!history) return 0
    const recent = history.filter((e) => now - e.ts < FAST_FAIL_THRESHOLD_MS)
    this.entries.set(taskId, recent)
    return recent.length
  }

  /** True if the task has reached the fast-fail exhaustion threshold within the window. */
  isExhausted(taskId: string, now: number = Date.now()): boolean {
    return this.recentCount(taskId, now) >= MAX_FAST_FAILS
  }

  /** Remove all fast-fail history for the given task (e.g. on successful completion). */
  clear(taskId: string): void {
    this.entries.delete(taskId)
  }
}

export class ErrorRegistry {
  readonly circuitBreaker: CircuitBreaker
  readonly fastFailTracker: FastFailTracker
  /** Per-task consecutive drain-loop failure counts. Cleared on success or quarantine. */
  private readonly drainFailureCounts: Map<string, number>

  constructor(logger: Logger) {
    this.circuitBreaker = new CircuitBreaker(logger)
    this.fastFailTracker = new FastFailTracker()
    this.drainFailureCounts = new Map()
  }

  /** True when the circuit breaker is currently open. */
  isCircuitOpen(now?: number): boolean {
    return this.circuitBreaker.isOpen(now)
  }

  /** Unix-ms timestamp at which the circuit breaker will re-close. */
  get circuitOpenUntil(): number {
    return this.circuitBreaker.openUntilTimestamp
  }

  recordSpawnSuccess(): void {
    this.circuitBreaker.recordSuccess()
  }

  recordSpawnFailure(taskId?: string, reason?: string): void {
    this.circuitBreaker.recordFailure(taskId, reason)
  }

  // ---- Drain-failure verb API ----

  incrementFailure(taskId: string): void {
    this.drainFailureCounts.set(taskId, (this.drainFailureCounts.get(taskId) ?? 0) + 1)
  }

  clearFailure(taskId: string): void {
    this.drainFailureCounts.delete(taskId)
  }

  failureCountFor(taskId: string): number {
    return this.drainFailureCounts.get(taskId) ?? 0
  }

  // ---- Legacy accessors (kept for backward compat until all callers migrate) ----

  getDrainFailureCount(taskId: string): number {
    return this.failureCountFor(taskId)
  }

  setDrainFailureCount(taskId: string, count: number): void {
    this.drainFailureCounts.set(taskId, count)
  }

  clearDrainFailureCount(taskId: string): void {
    this.clearFailure(taskId)
  }
}
