/**
 * Metrics collector for the AgentManager.
 * Tracks drain loop executions, agent lifecycle events, watchdog verdicts, and retry counts.
 */

export type { MetricsSnapshot } from '../../shared/types'
import type { MetricsSnapshot } from '../../shared/types'

type CounterKey = keyof Omit<
  MetricsSnapshot,
  'watchdogVerdicts' | 'lastDrainDurationMs' | 'uptimeMs'
>

export interface MetricsCollector {
  increment(key: CounterKey): void
  recordWatchdogVerdict(verdict: string): void
  setLastDrainDuration(ms: number): void
  snapshot(): MetricsSnapshot
  reset(): void
}

export function createMetricsCollector(): MetricsCollector {
  const startTime = Date.now()
  let counters: Record<string, number> = {}
  let watchdogVerdicts: Record<string, number> = {}
  let lastDrainDurationMs = 0

  return {
    increment(key) {
      counters[key] = (counters[key] ?? 0) + 1
    },
    recordWatchdogVerdict(verdict) {
      watchdogVerdicts[verdict] = (watchdogVerdicts[verdict] ?? 0) + 1
    },
    setLastDrainDuration(ms) {
      lastDrainDurationMs = ms
    },
    snapshot(): MetricsSnapshot {
      return {
        drainLoopCount: counters.drainLoopCount ?? 0,
        agentsSpawned: counters.agentsSpawned ?? 0,
        agentsCompleted: counters.agentsCompleted ?? 0,
        agentsFailed: counters.agentsFailed ?? 0,
        retriesQueued: counters.retriesQueued ?? 0,
        watchdogVerdicts: { ...watchdogVerdicts },
        lastDrainDurationMs,
        uptimeMs: Date.now() - startTime
      }
    },
    reset() {
      counters = {}
      watchdogVerdicts = {}
      lastDrainDurationMs = 0
    }
  }
}
