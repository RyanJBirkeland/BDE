import { useEffect } from 'react'
import { toast } from '../stores/toasts'

/**
 * Listens for `github:rate-limit-warning` IPC events from the main process
 * and surfaces a toast so the user knows their GitHub API quota is running low.
 */
export function useGitHubRateLimitWarning(): void {
  useEffect(() => {
    const unsubscribe = window.api.onGitHubRateLimitWarning(({ remaining, limit, resetEpoch }) => {
      const resetTime = new Date(resetEpoch * 1_000).toLocaleTimeString()
      toast.info(
        `GitHub API rate limit low: ${remaining}/${limit} remaining. Resets at ${resetTime}.`,
        { durationMs: 8_000 }
      )
    })
    return unsubscribe
  }, [])
}
