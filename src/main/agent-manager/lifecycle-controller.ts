import { WATCHDOG_INTERVAL_MS, ORPHAN_CHECK_INTERVAL_MS, WORKTREE_PRUNE_INTERVAL_MS } from './types'

export interface LoopCallbacks {
  onDrainTick: () => void
  onWatchdogTick: () => void
  onOrphanTick: () => void
  onPruneTick: () => void
}

/**
 * Per-timer initial delay offsets. When provided, the corresponding timer
 * fires its first tick after `initialDelayMs` instead of immediately.
 * Staggering prevents all four loop timers from firing at the same instant
 * at startup, spreading their I/O and CPU load across the first second.
 */
export interface TimerStaggerOptions {
  drainInitialDelayMs?: number
  watchdogInitialDelayMs?: number
  orphanInitialDelayMs?: number
  pruneInitialDelayMs?: number
}

/**
 * Owns the four periodic `setInterval` handles that drive the agent-manager
 * loop family. Single responsibility: start all timers together, stop all
 * timers together. Nothing else.
 */
export class LifecycleController {
  private poll: ReturnType<typeof setInterval> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private orphan: ReturnType<typeof setInterval> | null = null
  private prune: ReturnType<typeof setInterval> | null = null

  /** Pending initial-delay handles — cleared on stopTimers(). */
  private readonly staggerHandles: ReturnType<typeof setTimeout>[] = []

  startTimers(
    pollIntervalMs: number,
    callbacks: LoopCallbacks,
    stagger: TimerStaggerOptions = {}
  ): void {
    this.scheduleWithStagger(
      stagger.drainInitialDelayMs,
      () => {
        this.poll = setInterval(callbacks.onDrainTick, pollIntervalMs)
      }
    )
    this.scheduleWithStagger(
      stagger.watchdogInitialDelayMs,
      () => {
        this.watchdog = setInterval(callbacks.onWatchdogTick, WATCHDOG_INTERVAL_MS)
      }
    )
    this.scheduleWithStagger(
      stagger.orphanInitialDelayMs,
      () => {
        this.orphan = setInterval(callbacks.onOrphanTick, ORPHAN_CHECK_INTERVAL_MS)
      }
    )
    this.scheduleWithStagger(
      stagger.pruneInitialDelayMs,
      () => {
        this.prune = setInterval(callbacks.onPruneTick, WORKTREE_PRUNE_INTERVAL_MS)
      }
    )
  }

  /**
   * When `initialDelayMs` is provided, defers the timer start via setTimeout.
   * Otherwise starts the interval immediately (zero-delay behaviour preserved).
   */
  private scheduleWithStagger(
    initialDelayMs: number | undefined,
    startInterval: () => void
  ): void {
    if (initialDelayMs === undefined || initialDelayMs <= 0) {
      startInterval()
      return
    }
    const handle = setTimeout(() => {
      const idx = this.staggerHandles.indexOf(handle)
      if (idx !== -1) this.staggerHandles.splice(idx, 1)
      startInterval()
    }, initialDelayMs)
    this.staggerHandles.push(handle)
  }

  stopTimers(): void {
    // Cancel any pending stagger delays that haven't fired yet
    for (const handle of this.staggerHandles) {
      clearTimeout(handle)
    }
    this.staggerHandles.length = 0

    if (this.poll) {
      clearInterval(this.poll)
      this.poll = null
    }
    if (this.watchdog) {
      clearInterval(this.watchdog)
      this.watchdog = null
    }
    if (this.orphan) {
      clearInterval(this.orphan)
      this.orphan = null
    }
    if (this.prune) {
      clearInterval(this.prune)
      this.prune = null
    }
  }
}
