import { useEffect } from 'react'
import { useCostDataStore } from '../stores/costData'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_COST_INTERVAL } from '../lib/constants'

export function useCostPolling(): void {
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useVisibilityAwareInterval(fetchLocalAgents, POLL_COST_INTERVAL)
}
