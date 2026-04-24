import { WATCHDOG_INTERVAL_MS, ORPHAN_CHECK_INTERVAL_MS, WORKTREE_PRUNE_INTERVAL_MS } from './types'

export interface LoopCallbacks {
  onDrainTick: () => void
  onWatchdogTick: () => void
  onOrphanTick: () => void
  onPruneTick: () => void
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

  startTimers(pollIntervalMs: number, callbacks: LoopCallbacks): void {
    this.poll = setInterval(callbacks.onDrainTick, pollIntervalMs)
    this.watchdog = setInterval(callbacks.onWatchdogTick, WATCHDOG_INTERVAL_MS)
    this.orphan = setInterval(callbacks.onOrphanTick, ORPHAN_CHECK_INTERVAL_MS)
    this.prune = setInterval(callbacks.onPruneTick, WORKTREE_PRUNE_INTERVAL_MS)
  }

  stopTimers(): void {
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
