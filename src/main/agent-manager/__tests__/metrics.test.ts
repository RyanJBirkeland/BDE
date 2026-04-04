import { describe, it, expect } from 'vitest'
import { createMetricsCollector } from '../metrics'

describe('MetricsCollector', () => {
  it('starts with zero counters', () => {
    const m = createMetricsCollector()
    const s = m.snapshot()
    expect(s.drainLoopCount).toBe(0)
    expect(s.agentsSpawned).toBe(0)
    expect(s.agentsCompleted).toBe(0)
    expect(s.agentsFailed).toBe(0)
    expect(s.retriesQueued).toBe(0)
  })

  it('increments counters', () => {
    const m = createMetricsCollector()
    m.increment('drainLoopCount')
    m.increment('drainLoopCount')
    m.increment('agentsSpawned')
    expect(m.snapshot().drainLoopCount).toBe(2)
    expect(m.snapshot().agentsSpawned).toBe(1)
  })

  it('tracks watchdog verdicts by type', () => {
    const m = createMetricsCollector()
    m.recordWatchdogVerdict('idle')
    m.recordWatchdogVerdict('idle')
    m.recordWatchdogVerdict('max-runtime')
    expect(m.snapshot().watchdogVerdicts.idle).toBe(2)
    expect(m.snapshot().watchdogVerdicts['max-runtime']).toBe(1)
  })

  it('resets counters', () => {
    const m = createMetricsCollector()
    m.increment('agentsSpawned')
    m.recordWatchdogVerdict('idle')
    m.setLastDrainDuration(500)
    m.reset()
    expect(m.snapshot().agentsSpawned).toBe(0)
    expect(m.snapshot().watchdogVerdicts).toEqual({})
    expect(m.snapshot().lastDrainDurationMs).toBe(0)
  })

  it('tracks uptime', () => {
    const m = createMetricsCollector()
    expect(m.snapshot().uptimeMs).toBeGreaterThanOrEqual(0)
  })

  it('sets last drain duration', () => {
    const m = createMetricsCollector()
    m.setLastDrainDuration(150)
    expect(m.snapshot().lastDrainDurationMs).toBe(150)
  })

  it('returns a copy of watchdogVerdicts (not mutating internal state)', () => {
    const m = createMetricsCollector()
    m.recordWatchdogVerdict('idle')
    const snap = m.snapshot()
    snap.watchdogVerdicts.idle = 999
    expect(m.snapshot().watchdogVerdicts.idle).toBe(1)
  })
})
