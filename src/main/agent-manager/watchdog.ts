export type TimeoutReason = 'max_runtime' | 'idle'

export interface WatchdogOptions {
  maxRuntimeMs: number
  idleMs: number
  onTimeout: (reason: TimeoutReason) => void
}

export class Watchdog {
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly opts: WatchdogOptions

  constructor(opts: WatchdogOptions) {
    this.opts = opts
  }

  start(): void {
    this.maxTimer = setTimeout(() => this.opts.onTimeout('max_runtime'), this.opts.maxRuntimeMs)
    this.resetIdle()
  }

  ping(): void {
    this.resetIdle()
  }

  stop(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.maxTimer = null
    this.idleTimer = null
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.opts.onTimeout('idle'), this.opts.idleMs)
  }
}
