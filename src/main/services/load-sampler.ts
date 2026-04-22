import os from 'node:os'

export interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

export const SAMPLE_INTERVAL_MS = 5_000
export const BUFFER_SIZE = 120 // 10 minutes at 5s

/**
 * Samples `os.loadavg()` on a fixed cadence and exposes the most recent
 * 10-minute window. Encapsulates the previously module-level ring buffer,
 * timer, and cpu-count cache so the lifetime is owned by the caller.
 */
export class LoadSampler {
  private ring: LoadSample[] = []
  private timer: NodeJS.Timeout | null = null
  private cpuCount = os.cpus().length

  start(): void {
    if (this.timer) return
    this.cpuCount = os.cpus().length
    this.sample()
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  snapshot(): { samples: LoadSample[]; cpuCount: number } {
    return { samples: this.ring.slice(), cpuCount: this.cpuCount }
  }

  /** Test-only — wipe buffer and timer. */
  reset(): void {
    this.stop()
    this.ring = []
    this.cpuCount = os.cpus().length
  }

  private sample(): void {
    const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg()
    this.ring.push({ t: Date.now(), load1, load5, load15 })
    if (this.ring.length > BUFFER_SIZE) this.ring.shift()
  }
}

const defaultSampler = new LoadSampler()

export function startLoadSampler(): void {
  defaultSampler.start()
}

export function stopLoadSampler(): void {
  defaultSampler.stop()
}

export function getLoadSnapshot(): { samples: LoadSample[]; cpuCount: number } {
  return defaultSampler.snapshot()
}

/** @internal Test-only: wipe buffer + timer. */
export function _resetForTests(): void {
  defaultSampler.reset()
}
