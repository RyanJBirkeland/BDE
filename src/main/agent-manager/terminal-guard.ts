/**
 * TerminalGuard — idempotency wrapper for onTaskTerminal calls.
 *
 * Owns the taskId → in-flight Promise map used to deduplicate concurrent
 * terminal calls for the same task. A second caller for the same taskId
 * receives the in-flight promise rather than invoking the handler again.
 * The map entry is deleted in a `finally` block so subsequent calls for
 * the same task can proceed after the first call resolves.
 */

export class TerminalGuard {
  private readonly inFlight = new Map<string, Promise<void>>()

  /**
   * Execute `fn` for `taskId`, or return the in-flight promise if a call
   * for the same task is already running. The guard entry is always cleaned
   * up in `finally` so future calls are never permanently blocked.
   */
  guardedCall(taskId: string, fn: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(taskId)
    if (existing) return existing

    const work = fn().finally(() => {
      this.inFlight.delete(taskId)
    })
    this.inFlight.set(taskId, work)
    return work
  }
}
