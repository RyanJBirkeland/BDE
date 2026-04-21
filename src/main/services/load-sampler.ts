import os from 'node:os'

export interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

export const SAMPLE_INTERVAL_MS = 5_000
export const BUFFER_SIZE = 120 // 10 minutes at 5s

let ring: LoadSample[] = []
let timer: NodeJS.Timeout | null = null
let cpuCount = os.cpus().length

function sample(): void {
  const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg()
  ring.push({ t: Date.now(), load1, load5, load15 })
  if (ring.length > BUFFER_SIZE) ring.shift()
}

export function startLoadSampler(): void {
  if (timer) return
  // Refresh cpuCount in case of unusual hotplug scenarios
  cpuCount = os.cpus().length
  sample() // seed immediately so consumers see something
  timer = setInterval(sample, SAMPLE_INTERVAL_MS)
  timer.unref?.() // don't hold the process open in tests
}

export function stopLoadSampler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getLoadSnapshot(): { samples: LoadSample[]; cpuCount: number } {
  // Return a copy so callers can't mutate internal state
  return { samples: ring.slice(), cpuCount }
}

/** @internal Test-only: wipe buffer + timer. */
export function _resetForTests(): void {
  stopLoadSampler()
  ring = []
  cpuCount = os.cpus().length
}
