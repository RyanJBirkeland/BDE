import { useCallback, useState } from 'react'
import { useBackoffInterval } from './useBackoffInterval'

const STATUS_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_SLOTS = 2

export interface AgentManagerStatus {
  activeCount: number
  maxSlots: number
}

/**
 * Polls the agent manager for live concurrency state. Errors are swallowed —
 * stale values are preferable to noisy retries when the manager is briefly
 * unavailable (e.g. during reload). The first tick fires within a small jitter
 * offset thanks to `useBackoffInterval`, so callers see real values quickly.
 */
export function useAgentManagerStatus(): AgentManagerStatus {
  const [activeCount, setActiveCount] = useState(0)
  const [maxSlots, setMaxSlots] = useState(DEFAULT_MAX_SLOTS)

  const pollStatus = useCallback(async () => {
    try {
      const status = await window.api.agentManager.status()
      setActiveCount(status.concurrency.activeCount)
      setMaxSlots(status.concurrency.maxSlots)
    } catch {
      // Agent manager may be momentarily unavailable; keep stale values.
    }
  }, [])

  useBackoffInterval(pollStatus, STATUS_POLL_INTERVAL_MS)

  return { activeCount, maxSlots }
}
