import { useEffect } from 'react'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_SESSIONS_INTERVAL } from '../lib/constants'

export function useAgentSessionPolling(): void {
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  useVisibilityAwareInterval(fetchAgents, POLL_SESSIONS_INTERVAL)
}
