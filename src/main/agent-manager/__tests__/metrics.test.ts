import { describe, it, expect, beforeEach } from 'vitest'
import { createMetricsCollector, type MetricsCollector } from '../metrics'

describe('metrics', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = createMetricsCollector()
  })

  describe('createMetricsCollector', () => {
    it('should initialize with zero counters', () => {
      const snapshot = collector.snapshot()
      expect(snapshot.drainLoopCount).toBe(0)
      expect(snapshot.agentsSpawned).toBe(0)
      expect(snapshot.agentsCompleted).toBe(0)
      expect(snapshot.agentsFailed).toBe(0)
      expect(snapshot.retriesQueued).toBe(0)
      expect(snapshot.lastDrainDurationMs).toBe(0)
      expect(snapshot.watchdogVerdicts).toEqual({})
    })

    it('should track uptime from creation', () => {
      const snapshot1 = collector.snapshot()
      expect(snapshot1.uptimeMs).toBeGreaterThanOrEqual(0)

      const start = Date.now()
      while (Date.now() - start < 10) {
        // busy wait
      }

      const snapshot2 = collector.snapshot()
      expect(snapshot2.uptimeMs).toBeGreaterThan(snapshot1.uptimeMs)
    })
  })

  describe('increment', () => {
    it('should increment counters', () => {
      collector.increment('drainLoopCount')
      collector.increment('agentsSpawned')
      collector.increment('agentsSpawned')

      const snapshot = collector.snapshot()
      expect(snapshot.drainLoopCount).toBe(1)
      expect(snapshot.agentsSpawned).toBe(2)
    })

    it('should handle multiple increments of same counter', () => {
      for (let i = 0; i < 5; i++) {
        collector.increment('agentsCompleted')
      }

      expect(collector.snapshot().agentsCompleted).toBe(5)
    })

    it('should increment all counter types', () => {
      collector.increment('drainLoopCount')
      collector.increment('agentsSpawned')
      collector.increment('agentsCompleted')
      collector.increment('agentsFailed')
      collector.increment('retriesQueued')

      const snapshot = collector.snapshot()
      expect(snapshot.drainLoopCount).toBe(1)
      expect(snapshot.agentsSpawned).toBe(1)
      expect(snapshot.agentsCompleted).toBe(1)
      expect(snapshot.agentsFailed).toBe(1)
      expect(snapshot.retriesQueued).toBe(1)
    })
  })

  describe('recordWatchdogVerdict', () => {
    it('should record watchdog verdicts', () => {
      collector.recordWatchdogVerdict('timeout')
      collector.recordWatchdogVerdict('success')
      collector.recordWatchdogVerdict('timeout')

      const snapshot = collector.snapshot()
      expect(snapshot.watchdogVerdicts['timeout']).toBe(2)
      expect(snapshot.watchdogVerdicts['success']).toBe(1)
    })

    it('should handle multiple verdict types', () => {
      collector.recordWatchdogVerdict('timeout')
      collector.recordWatchdogVerdict('aborted')
      collector.recordWatchdogVerdict('error')

      const verdicts = collector.snapshot().watchdogVerdicts
      expect(verdicts['timeout']).toBe(1)
      expect(verdicts['aborted']).toBe(1)
      expect(verdicts['error']).toBe(1)
    })
  })

  describe('setLastDrainDuration', () => {
    it('should record drain duration', () => {
      collector.setLastDrainDuration(150)
      expect(collector.snapshot().lastDrainDurationMs).toBe(150)
    })

    it('should overwrite previous duration', () => {
      collector.setLastDrainDuration(100)
      collector.setLastDrainDuration(200)
      expect(collector.snapshot().lastDrainDurationMs).toBe(200)
    })
  })

  describe('reset', () => {
    it('should reset all counters to zero', () => {
      collector.increment('drainLoopCount')
      collector.increment('agentsSpawned')
      collector.recordWatchdogVerdict('timeout')
      collector.setLastDrainDuration(100)

      collector.reset()

      const snapshot = collector.snapshot()
      expect(snapshot.drainLoopCount).toBe(0)
      expect(snapshot.agentsSpawned).toBe(0)
      expect(snapshot.lastDrainDurationMs).toBe(0)
      expect(snapshot.watchdogVerdicts).toEqual({})
    })

    it('should not reset uptime', () => {
      const before = collector.snapshot().uptimeMs
      collector.reset()
      const after = collector.snapshot().uptimeMs
      expect(after).toBeGreaterThanOrEqual(before)
    })
  })

  describe('snapshot', () => {
    it('should return independent copies', () => {
      const snap1 = collector.snapshot()
      collector.increment('agentsSpawned')
      const snap2 = collector.snapshot()

      expect(snap1.agentsSpawned).toBe(0)
      expect(snap2.agentsSpawned).toBe(1)
    })

    it('should not share watchdog verdict object references', () => {
      collector.recordWatchdogVerdict('timeout')
      const snap1 = collector.snapshot()
      snap1.watchdogVerdicts['injected'] = 999

      const snap2 = collector.snapshot()
      expect(snap2.watchdogVerdicts['injected']).toBeUndefined()
    })
  })
})
